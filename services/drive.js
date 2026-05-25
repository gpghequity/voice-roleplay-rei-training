const { getAccessToken } = require('./auth');

async function ensureCallerFolder(callerName, token) {
  const parentId = process.env.DRIVE_PARENT_FOLDER_ID;
  const q = `'${parentId}' in parents and name = '${callerName.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const search = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await search.json();
  if (data.files && data.files.length > 0) return data.files[0].id;

  const create = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: callerName, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] })
  });
  const folder = await create.json();
  if (!folder.id) throw new Error('Failed to create caller folder: ' + JSON.stringify(folder));
  return folder.id;
}

async function uploadTranscript(callerName, filename, content) {
  const token = await getAccessToken();
  const folderId = await ensureCallerFolder(callerName, token);

  const boundary = 'REIPractice_boundary_001';
  const metadata = JSON.stringify({ name: filename, parents: [folderId] });
  const body = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    metadata,
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    '',
    content,
    `--${boundary}--`
  ].join('\r\n');

  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`
    },
    body
  });

  const result = await res.json();
  if (!result.id) throw new Error('Drive upload failed: ' + JSON.stringify(result));
  return filename;
}

module.exports = { uploadTranscript };
