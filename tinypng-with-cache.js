const axios = require('axios');
const https = require('https');
const fs = require('fs-extra');
const md5 = require('md5');
const prettyBytes = require('pretty-bytes');

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
            console.log('\n提供的 apiKey 已均不可用，压缩结束。');
            return false;
        }
    }

    getToken() {
        return this.AUTH_TOKEN;
    }

    nextKey() {
        this.currentKeyIndex++;
        console.log('\napiKey 无效或已超使用限制，切换下一个');
        return this.updateAuthToken();
    }
}

class TinyPngCompressor {
    constructor(options) {
        this._createMd5FormOrigin = options.createMd5FormOrigin;
        this._minCompressPercentLimit = options.minCompressPercentLimit;
        this._md5RecordFilePath = options.md5RecordFilePath;
        this._reportFilePath = options.reportFilePath;
        this.md5RecordList = [];
        this.recordList = [];
        this.compressionInfo = {
            num: 0,
            saveSize: 0,
            originSize: 0,
            savePercent: 0,
        };
        this.currentFileName = '';
        this.apiKeyManager = new ApiKeyManager(options.apiKeyList);
        this.intervalId = -1;

        this.initializeMd5RecordList();
        this.spin();

        // 监听进程退出事件，记录压缩结果
        process.on('exit', () => this.recordResult(true));
    }

    // 初始化 md5 记录列表
    initializeMd5RecordList() {
        try {
            if (fs.existsSync(this._md5RecordFilePath)) {
                const fileContent = fs.readFileSync(this._md5RecordFilePath, 'utf8');
                this.md5RecordList = JSON.parse(fileContent || '[]');
            } else {
                this.md5RecordList = [];
                fs.writeFileSync(this._md5RecordFilePath, '[]', 'utf8');
            }
        } catch (e) {
            // 如果解析 JSON 失败，初始化为空数组
            this.md5RecordList = [];
        }
    }

    // 压缩进度条
    spin() {
        let index = 0;
        let dotList = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏';
        clearInterval(this.intervalId);
        this.intervalId = setInterval(() => {
            if (this.currentFileName) {
                index++;
                process.stdout.write(`\r${dotList[index % dotList.length]} 压缩中 ${this.currentFileName}`);
            }
        }, 200);
    }

    // 压缩文件
    async compress(file) {
        if (this._createMd5FormOrigin) {
            this.md5RecordList.push(md5(file.contents));
            return file;
        }

        if (this._md5RecordFilePath && this.md5RecordList.indexOf(md5(file.contents)) > -1) {
            return file;
        }

        this.currentFileName = file.relative;
        let prevSize = file.contents.length;
        if (!prevSize) {
            console.log(`\n${this.currentFileName} 文件信息错误，无法获取文件大小，跳过压缩`);
            return file;
        }

        return new Promise((resolve) => {
            this.tinypng(file, (data) => {
                this.processCompressedData(file, data, prevSize);
                this.recordResult();
                resolve(file);
            });
        });
    }

    async tinypng(file, cb) {
        try {
            const response = await axios({
                method: 'POST',
                url: 'https://api.tinypng.com/shrink',
                data: file.contents,
                headers: {
                    'Accept': '*/*',
                    'Cache-Control': 'no-cache',
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Authorization': 'Basic ' + this.apiKeyManager.getToken(),
                },
                httpsAgent: new https.Agent({
                    rejectUnauthorized: false
                }),
            });

            const results = response.data;
            // 压缩成功后下载压缩后的文件
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
                    console.log('\n[error] : 文件下载错误 - ', downLoadError);
                }
            } else {
                this.handleError(results.message, () => this.tinypng(file, cb), () => cb(file.contents));
            }
        } catch (error) {
            this.handleError(error.response.data.message, () => this.tinypng(file, cb), () => cb(file.contents));
        }
    }

    handleError(errorMsg, tryNextKeyCb, skipFileCb) {
        const keyErrorList = [
            'Credentials are invalid.',
            'Your monthly limit has been exceeded.',
        ];
        if (keyErrorList.includes(errorMsg)) {
            if (this.apiKeyManager.nextKey()) {
                tryNextKeyCb();
            } else {
                clearInterval(this.intervalId);
                console.log('\n所有API Key均已失效或超限，无法继续压缩。');
            }
        } else {
            console.log('[error] : 文件不可压缩 - ', errorMsg);
            skipFileCb();
        }
    }

    processCompressedData(file, data, prevSize) {
        const compressPercent = (1 - data.length / prevSize) * 100;
        const compressPercentStr = compressPercent.toFixed(0) + '%';
        
        if (compressPercent < this._minCompressPercentLimit) {
            this.handleLowCompression(file, compressPercentStr);
        } else {
            this.handleSuccessfulCompression(file, data, prevSize, compressPercent);
        }
    }

    handleLowCompression(file, compressPercentStr) {
        this.md5RecordList.push(md5(file.contents));
        console.log(`\n压缩比例低于安全线，保存源文件: ${file.relative} 【${compressPercentStr}】`);
    }

    handleSuccessfulCompression(file, data, prevSize, compressPercent) {
        file.contents = data;
        this.updateCompressionInfo(prevSize, data.length);
        this.md5RecordList.push(md5(data));
        const record = this.createCompressionRecord(file, prevSize, data.length, compressPercent);
        this.recordList.push(record);
        console.log('\n' + record);
    }

    updateCompressionInfo(prevSize, newSize) {
        this.compressionInfo.num++;
        this.compressionInfo.saveSize += prevSize - newSize;
        this.compressionInfo.originSize += prevSize;
    }

    createCompressionRecord(file, prevSize, newSize, compressPercent) {
        let record = '压缩成功  ';
        record += `前: ${prettyBytes(prevSize)}`.padEnd(15);
        record += `后: ${prettyBytes(newSize)}`.padEnd(15);
        record += `压缩: ${prettyBytes(prevSize - newSize)}`.padEnd(18);
        record += `压缩百分比: ${compressPercent.toFixed(2)}%`.padEnd(18);
        record += `${file.relative}`;
        return record;
    }

    recordResult(withLog = false) {
        const record = `共压缩 ${this.compressionInfo.num} 个文件，压缩前 ${prettyBytes(this.compressionInfo.originSize)}，压缩后 ${prettyBytes(this.compressionInfo.originSize - this.compressionInfo.saveSize)}，节省 ${prettyBytes(this.compressionInfo.saveSize)} 空间，压缩百分比 ${((this.compressionInfo.saveSize / (this.compressionInfo.originSize || 1)) * 100).toFixed(0)}%`;
        withLog && console.log('\n' + record);
        const _recordList = [].concat(this.recordList);
        _recordList.push(record);
        this._md5RecordFilePath && fs.writeFileSync(this._md5RecordFilePath, JSON.stringify(this.md5RecordList, null, 2));
        this._reportFilePath && fs.writeFileSync(this._reportFilePath, JSON.stringify(_recordList, null, 2));
    }

    finish() {
        clearInterval(this.intervalId);
    }
}

module.exports = function(options) {
    return new TinyPngCompressor(options);
};
