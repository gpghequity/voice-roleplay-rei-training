const { google } = require('googleapis');
const { makeAuth } = require('./auth');

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';

function driveClient() {
  return google.drive({ version: 'v3', auth: makeAuth([DRIVE_SCOPE]) });
}

async function ensureCallerFolder(drive, callerName) {
  const parentId = process.env.DRIVE_PARENT_FOLDER_ID;
  const safeName = callerName.replace(/'/g, "\\'");
  const q = `'${parentId}' in parents and name = '${safeName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;

  const search = await drive.files.list({ q, fields: 'files(id,name)', spaces: 'drive' });
  if (search.data.files && search.data.files.length > 0) return search.data.files[0].id;

  const folder = await drive.files.create({
    requestBody: { name: callerName, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] },
    fields: 'id'
  });
  return folder.data.id;
}

async function uploadTranscript(callerName, filename, content) {
  const drive = driveClient();
  const folderId = await ensureCallerFolder(drive, callerName);

  const { Readable } = require('stream');
  const stream = Readable.from([content]);

  const res = await drive.files.create({
    requestBody: { name: filename, parents: [folderId] },
    media: { mimeType: 'text/plain', body: stream },
    fields: 'id,name'
  });

  if (!res.data.id) throw new Error('Drive upload failed — no id returned');
  return filename;
}

module.exports = { uploadTranscript };
