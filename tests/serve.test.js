const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createServer } = require('./serve.js');

test('le serveur ne sert que les fichiers publics', async t => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const request = pathname => new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port: server.address().port, path: pathname }, response => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
    }).on('error', reject);
  });
  for (const pathname of ['/', '/styles.css', '/src/core.js', '/manifest.webmanifest']) {
    assert.equal(await request(pathname), 200, pathname);
  }
  for (const pathname of ['/elk-sauvegarde-test.json', '/elk-modele-test.json', '/notes.txt', '/.gitignore', '/tests/core.test.js', '/src%2F..%2FREADME.md']) {
    assert.equal(await request(pathname), 404, pathname);
  }
});
