const gunzipMaybe = require('gunzip-maybe');
const Progress    = require('progress');
const tarFs       = require('tar-fs');
const tar         = require('tar-stream');

function getFileName(entryName, virtualPath) {

    entryName = entryName.replace(/^\/+/, ``);

    for (let t = 0; t < virtualPath; ++t) {

        let index = entryName.indexOf(`/`);

        if (index === -1)
            return null;

        entryName = entryName.substr(index + 1);

    }

    return entryName;

}

async function extractArchiveTo(packageBuffer, target, {virtualPath = 0} = {}) {

    return new Promise((resolve, reject) => {

        function map(header) {
            header.name = getFileName(header.name, virtualPath);
            return header;
        }

        let gunzipper = gunzipMaybe();

        let extractor = tarFs.extract(target, { map });
        gunzipper.pipe(extractor);

        extractor.on(`error`, error => {
            reject(error);
        });

        extractor.on(`finish`, () => {
            resolve();
        });

        gunzipper.write(packageBuffer);
        gunzipper.end();

    });

}

module.exports.extractArchiveTo = extractArchiveTo;
