const axios = require('axios');
const https = require('https');
const fs = require('fs-extra');
const md5 = require('md5');
const prettyBytes = require('pretty-bytes');

let _createMd5FormOrigin = false
let _minCompressPercentLimit = 0
let _md5RecordFilePath = ''
let _reportFilePath = ''
let _apiKeyList = []
let recordList = []
let md5RecordList = []
let intervalId = -1
let currentFileName = ''

let compressionInfo = {
    num: 0,
    saveSize: 0,
    originSize: 0,
    savePercent: 0,
}

console._log = (...params) => {
    process.stdout.write(`\r`)
    console.log(...params)
}

process.on('exit', () => recordResult(true))

function recordResult(withLog) {
    const record = `共压缩 ${compressionInfo.num} 个文件，压缩前 ${prettyBytes(compressionInfo.originSize)}，压缩后 ${prettyBytes(compressionInfo.originSize - compressionInfo.saveSize)}，节省 ${prettyBytes(compressionInfo.saveSize)} 空间，压缩百分比 ${((compressionInfo.saveSize / (compressionInfo.originSize || 1)) * 100).toFixed(0)}%`
    withLog && console._log(record)
    const _recordList = [].concat(recordList)
    _recordList.push(record)
    _md5RecordFilePath && fs.writeFileSync(_md5RecordFilePath, JSON.stringify(md5RecordList, null, 2))
    _reportFilePath && fs.writeFileSync(_reportFilePath, JSON.stringify(_recordList, null, 2))
}

// 压缩进度条
function spin() {
    let index = 0
    let dotList = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
    clearInterval(intervalId)
    intervalId = setInterval(() => {
        if (currentFileName) {
            index++
            process.stdout.write(`\r${dotList[index % dotList.length]} 压缩中 ${currentFileName}`)
        }
    }, 200)
}

// apiKey 管理
class ApiKeyManager {
    constructor(apiKeys) {
        this.apiKeys = apiKeys;
        this.currentKeyIndex = 0;
        this.AUTH_TOKEN = '';
        this.updateAuthToken();
    }

    updateAuthToken() {
        if (this.currentKeyIndex < this.apiKeys.length) {
            const currentKey = this.apiKeys[this.currentKeyIndex];
            this.AUTH_TOKEN = Buffer.from('api:' + currentKey).toString('base64');
            console.log(`使用第 ${this.currentKeyIndex + 1}个 apiKey: ${currentKey}`);
            return true;
        } else {
            console.log('提供的 apiKey 已均不可用，压缩结束。');
            return false;
        }
    }

    getToken() {
        return this.AUTH_TOKEN;
    }

    nextKey() {
        this.currentKeyIndex++;
        console.log('apiKey 无效或已超使用限制，切换下一个');
        return this.updateAuthToken();
    }
}

// 压缩图片请求
async function tinypng(file, apiKeyManager, cb) {
    try {
        const response = await axios({
            method: 'POST',
            url: 'https://api.tinypng.com/shrink',
            data: file.contents,
            headers: {
                'Accept': '*/*',
                'Cache-Control': 'no-cache',
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': 'Basic ' + apiKeyManager.getToken(),
            },
            httpsAgent: new https.Agent({
                rejectUnauthorized: false
            }),
        });

        const results = response.data;
        if (results.output && results.output.url) {
            try {
                const compressedFileResponse = await axios({
                    method: 'get',
                    url: results.output.url,
                    responseType: 'arraybuffer',
                    httpsAgent: new https.Agent({
                        rejectUnauthorized: false
                    }),
                });
                cb(compressedFileResponse.data);
            } catch (downLoadError) {
                console._log('[error] : 文件下载错误 - ', downLoadError)
            }
        } else {
            handleError(results.message, apiKeyManager, tinypng.bind(null, file, apiKeyManager, cb), () => cb(file.contents));
        }
    } catch (error) {
        handleError(error.response.data.message, apiKeyManager, tinypng.bind(null, file, apiKeyManager, cb), () => cb(file.contents));
    }
}

// 处理错误
async function handleError(errorMsg, apiKeyManager, tryNextKeyCb, skipFileCb) {
    const keyErrorList = [
        'Credentials are invalid.',
        'Your monthly limit has been exceeded.',
    ];
    if (keyErrorList.includes(errorMsg)) {
        if (apiKeyManager.nextKey()) {
            tryNextKeyCb();
        } else {
            clearInterval(intervalId)
            console.log('所有API Key均已失效或超限，无法继续压缩。');
        }
    } else {
        console.log('[error] : 文件不可压缩 - ', errorMsg);
        skipFileCb();
    }
}

function main({ apiKeyList = [], md5RecordFilePath, reportFilePath, minCompressPercentLimit = 0, createMd5FormOrigin = false }) {
    const apiKeyManager = new ApiKeyManager(apiKeyList);
    _apiKeyList = apiKeyList
    _md5RecordFilePath = md5RecordFilePath
    _reportFilePath = reportFilePath
    _minCompressPercentLimit = minCompressPercentLimit
    _createMd5FormOrigin = createMd5FormOrigin
    
    spin()
    try {
        md5RecordList = JSON.parse(fs.readFileSync(_md5RecordFilePath) || '[]')
    } catch (e) {
        // 处理文件读取错误
    }

    return {
        compress: async function(file) {
            if (_createMd5FormOrigin) {
                md5RecordList.push(md5(file.contents))
                return file
            }

            if (_md5RecordFilePath && md5RecordList.indexOf(md5(file.contents)) > -1) {
                return file
            }

            currentFileName = file.relative
            let prevSize = file.contents.length
            if (!prevSize) {
                console.log(`${currentFileName} 文件信息错误，无法获取文件大小，跳过压缩`)
                return file
            }

            return new Promise((resolve) => {
                tinypng(file, apiKeyManager, (data) => {
                    const compressPercent = (1 - data.length / prevSize) * 100
                    const compressPercentStr = compressPercent.toFixed(0) + '%'
                    if (compressPercent < _minCompressPercentLimit) {
                        md5RecordList.push(md5(file.contents))
                        console._log(`压缩比例低于安全线，保存源文件: ${file.relative} 【${compressPercentStr}】`)
                    } else {
                        file.contents = data
                        compressionInfo.num++
                        compressionInfo.saveSize += prevSize - data.length
                        compressionInfo.originSize += prevSize
                        md5RecordList.push(md5(data))
                        let record = '压缩成功  '
                        record += `前: ${prettyBytes(prevSize)}`.padEnd(15)
                        record += `后: ${prettyBytes(data.length)}`.padEnd(15)
                        record += `压缩: ${prettyBytes(prevSize - data.length)}`.padEnd(18)
                        record += `压缩百分比: ${((prevSize - data.length) / (prevSize || 1) * 100).toFixed(2)}%`.padEnd(18)
                        record += `${file.relative} `
                        recordList.push(record)
                        console._log(record)
                    }
                    recordResult()
                    resolve(file)
                })
            })
        },
        finish: function() {
            clearInterval(intervalId)
        }
    }
}

module.exports = main;