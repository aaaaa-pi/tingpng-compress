const fs = require('fs-extra');
const path = require('path');
const { glob } = require('glob');
const tinypngWithCache = require('./tinypng-with-cache');

let apiKeyList = [];
let basePath = process.cwd();
let createMd5FormOrigin = false;

if (global.tinypngConf) {
  basePath = tinypngConf.basePath || basePath;
  apiKeyList = tinypngConf.apiKeyList || apiKeyList;
  createMd5FormOrigin = tinypngConf.createMd5FormOrigin || createMd5FormOrigin;
}

basePath = process.argv[2] || basePath;
createMd5FormOrigin = process.argv[3] || createMd5FormOrigin;
apiKeyList = process.argv[4] ? process.argv[4].split(',') : apiKeyList;

let fileFilter = tinypngConf.fileFilter || [
  '**/*.png',
  '**/*.jpg',
  '**/*.jpeg',
  '!node_modules/**',
  '!dist/**',
];

console.log({
  basePath,
  apiKeyList,
  fileFilter,
  createMd5FormOrigin,
});

if (!apiKeyList.length) {
  return console.error('tinypng-script-with-cache', 'tinypny key 列表不能为空!');
}

const options = {
  apiKeyList,
  reportFilePath: path.join(basePath, 'tinypngReport.json'),
  md5RecordFilePath: path.join(basePath, 'tinypngMd5Record.json'),
  minCompressPercentLimit: 10,
  createMd5FormOrigin,
};

const tinypng = tinypngWithCache(options);

(async () => {
  try {
    const files = await glob(fileFilter, { cwd: basePath, nodir: true });
    
    for (const file of files) {
      const filePath = path.join(basePath, file);
      const fileContents = await fs.readFile(filePath);
      const fileObj = { contents: fileContents, relative: file };

      const compressedFile = await tinypng.compress(fileObj);
      
      if (compressedFile.contents !== fileContents) {
        await fs.writeFile(filePath, compressedFile.contents);
        console.log(`${file}`);
      } else {
        console.log(`未压缩: ${file}`);
      }
    }
  } catch (error) {
    console.error('[error] : 压缩出错了 - ', error);
  } finally {
    tinypng.finish();
  }
})();