/**
 * The endpoint OCD posts to: `src/main/feedback.ts`.
 *
 * Two kinds of event, one Sheet file each:
 *  - `install`  — sent once per installed version, never per launch;
 *  - `feedback` — what someone typed into the About screen.
 *
 * Deploy as a web app (Execute as: Me, Who has access: Anyone), then paste the
 * `/exec` URL into BACKEND_URL in src/main/feedback.ts. See README.md next to
 * this file.
 *
 * The deployment URL is the only secret in this scheme: Apps Script does not
 * authenticate a POST, so anyone holding the URL can write rows. It is worth
 * treating the URL as a password — and worth remembering that `doGet` below is
 * readable by the same people, which is why it counts rows and prints nothing
 * that came out of a feedback message.
 */

/** The spreadsheet to write into. Set it, or run setup() and paste the id here. */
var SHEET_ID = "PASTE_SPREADSHEET_ID_HERE";

var INSTALLS = "Installs";
var FEEDBACK = "Feedback";

/** A request the app never sends; anything else is ignored. */
var APP_NAME = "OCD";

var INSTALL_HEADERS = ["when", "version", "installId", "os", "arch", "electron", "locale"];
var FEEDBACK_HEADERS = ["when", "kind", "message", "contact", "version", "installId", "os", "electron", "log"];

/**
 * Accept one event.
 *
 * The answer is always `ok` for a body that parsed, even when the row was not
 * written: the app treats a 200 as delivered and anything else as a failure it
 * retries on the next launch. Throwing here would turn "this row was refused"
 * into "the whole message was lost", and a lost complaint is worse than a lost
 * row.
 */
function doPost(e) {
  var body = readJson(e);
  if (!body || body.app !== APP_NAME) return json({ ok: false, error: "not an OCD event" });

  try {
    if (body.event === "install") {
      append(INSTALLS, INSTALL_HEADERS, [
        stamp(),
        text(body.version, 40),
        text(body.installId, 64),
        text(body.os, 120),
        text(body.arch, 20),
        text(body.electron, 20),
        text(body.locale, 20),
      ]);
    } else if (body.event === "feedback") {
      append(FEEDBACK, FEEDBACK_HEADERS, [
        stamp(),
        text(body.kind, 20),
        text(body.message, 4000),
        text(body.contact, 200),
        text(body.version, 40),
        text(body.installId, 64),
        text(body.os, 120),
        text(body.electron, 20),
        // Only ever arrives together with the box it was written for; the app
        // drops the log on its own when nobody asked to send it.
        text(body.log, 20000),
      ]);
    } else {
      return json({ ok: false, error: "unknown event: " + body.event });
    }
    return json({ ok: true });
  } catch (err) {
    // Logged rather than thrown: see the note above about 200.
    console.error("feedback endpoint failed: " + err);
    return json({ ok: false, error: String(err) });
  }
}

/**
 * A summary worth reading in a browser.
 *
 * The only figure that answers "did anyone else download this" is
 * `uniqueInstalls`: the app sends one mark per version per machine, so a machine
 * that updated from 0.1.1 to 0.1.13 writes thirteen rows and counts once.
 */
function doGet() {
  try {
    var installs = readSheet(INSTALLS);
    var ids = {};
    var versions = {};
    for (var i = 1; i < installs.length; i++) {
      var id = installs[i][2];
      var version = installs[i][1];
      if (id) ids[id] = true;
      if (version) versions[version] = (versions[version] || 0) + 1;
    }
    var count = 0;
    for (var key in ids) if (ids.hasOwnProperty(key)) count++;
    return json({
      ok: true,
      uniqueInstalls: count,
      marks: installs.length > 0 ? installs.length - 1 : 0,
      perVersion: versions,
      feedback: Math.max(0, readSheet(FEEDBACK).length - 1),
    });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

/** Create both sheets with their headers. Run once, by hand. */
function setup() {
  var book = SpreadsheetApp.getActiveSpreadsheet();
  var id = book.getId();
  ensureSheet(book, INSTALLS, INSTALL_HEADERS);
  ensureSheet(book, FEEDBACK, FEEDBACK_HEADERS);
  Logger.log("SHEET_ID = '%s'", id);
  Logger.log("Paste that into SHEET_ID above, then deploy as a web app.");
}

function ensureSheet(book, name, headers) {
  var sheet = book.getSheetByName(name);
  if (!sheet) sheet = book.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/**
 * One writer at a time.
 *
 * `appendRow` on its own is already atomic per row, but the sheet is created
 * here on the first request of a fresh deployment, and two simultaneous first
 * requests would each create one — leaving two sheets with the same name and a
 * reader that finds the empty one.
 */
function append(name, headers, row) {
  var book = open();
  lock(function () {
    var sheet = book.getSheetByName(name) || ensureSheet(book, name, headers);
    sheet.appendRow(row);
  });
}

function readSheet(name) {
  var sheet = open().getSheetByName(name);
  if (!sheet) return [];
  return sheet.getDataRange().getValues();
}

/** The active spreadsheet when run by hand, the named one when deployed. */
function open() {
  return SHEET_ID && SHEET_ID.indexOf("PASTE_") !== 0
    ? SpreadsheetApp.openById(SHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();
}

function lock(work) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    return work();
  } finally {
    lock.releaseLock();
  }
}

function readJson(e) {
  try {
    return JSON.parse((e && e.postData && e.postData.contents) || "{}");
  } catch (err) {
    return null;
  }
}

function stamp() {
  return new Date().toISOString();
}

/** Trimmed and capped: a row that cannot be read is a row nobody can answer. */
function text(value, limit) {
  if (value === undefined || value === null) return "";
  return String(value).trim().slice(0, limit);
}

/** JSON as a bare body: the app reads the status, and a wrapper would change it. */
function json(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(
    ContentService.MimeType.JSON
  );
}