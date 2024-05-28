const axios = require('axios');
const https = require('https');
const through = require('through2');
const fs = require('fs');
const md5 = require('md5'); 
const prettyBytes = require('pretty-bytes'); 
const SCRIPT_NAME = 'tinypng-compress' // 插件名

let _createMd5FormOrigin = false // 不进行压缩操作，只生成现有图片的 md5 信息，并作为缓存。只会在接入本项目时用一次。
let _minCompressPercentLimit = 0 // 默认值为零，最小压缩百分比限制，为保证图片质量，当压缩比例低于该值时，保持源文件，避免过分压缩，损伤图片质量
let _md5RecordFilePath = '' // 压缩后图片 md5 信息文件所在路径
let _reportFilePath = '' // 报告文件路径
let _apiKeyList = [] // key 列表
let recordList = [] // 压缩日志列表
let md5RecordList = [] // 图片压缩后的 md5 记录数组
let intervalId = -1 // 加载中计时器 id
let currentFileName = '' // 当前压缩中的文件

let compressionInfo = {
    num: 0, // 压缩的文件数
    saveSize: 0, // 节省的体积
    originSize: 0, // 文件未被压缩前总体积
    savePercent: 0, // 压缩百分比
}

console._log = (...params) => {
    process.stdout.write(`\r`)
    console.log(...params)
  }
  
// 进程退出前执行操作
process.on('exit', () => recordResult(true))

// 记录压缩结果
function recordResult (withLog) {
    const record = `共压缩 ${compressionInfo.num} 个文件，压缩前 ${prettyBytes(compressionInfo.originSize)}，压缩后 ${prettyBytes(compressionInfo.originSize - compressionInfo.saveSize)}，节省 ${prettyBytes(compressionInfo.saveSize)} 空间，压缩百分比 ${((compressionInfo.saveSize / (compressionInfo.originSize || 1)) * 100).toFixed(0)}%`
    withLog && console._log(record)
    const _recordList = [].concat(recordList)
    _recordList.push(record)
    _md5RecordFilePath && fs.writeFileSync(_md5RecordFilePath,JSON.stringify(md5RecordList,null,2))
    _reportFilePath && fs.writeFileSync(_reportFilePath,JSON.stringify(_recordList,null,2))
}

// 加载动画
function spin () {
    let index = 0
    let dotList = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
    clearInterval(intervalId)
    intervalId = setInterval(() => {
        if(currentFileName) {
            index ++
            process.stdout.write(`\r${dotList[index % dotList.length]} 压缩中 ${currentFileName}`)
        }
    },200)
}

// ApiKeyManager 类定义
class ApiKeyManager {
    constructor(apiKeys) {
        this.apiKeys = apiKeys
        this.currentKeyIndex = 0
        this.AUTH_TOKEN = ''
        this.updateAuthToken()
    }

    updateAuthToken() {
        if(this.currentKeyIndex < this.apiKeys.length) {
            const currentKey = this.apiKeys[this.currentKeyIndex]
            this.AUTH_TOKEN = Buffer.from('api:' + currentKey).toString('base64')
            console.log(`使用第 ${this.currentKeyIndex + 1}个 apiKey: ${currentKey}`)
            return true
        }else {
            console.log('提供的 apiKey 已均不可用，压缩结束。');
            return false
        }
    }

    getToken() {
        return this.AUTH_TOKEN;
    }
    
    nextKey() {
        this.currentKeyIndex++;
        console.log('apiKey 无效或已超使用限制，切换下一个')
        return this.updateAuthToken();
    }
}

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
        // 下载压缩后的文件
        try {
            const compressedFileResponse = await axios({
                method: 'get',
                url: results.output.url,
                responseType: 'arraybuffer',  // 以二进制形式接收文件内容
                httpsAgent: new https.Agent({
                  rejectUnauthorized: false
                }),
              });
              cb(compressedFileResponse.data); // 调用成功回调
        }catch(downLoadError){
            console._log('[error] : 文件下载错误 - ', downLoadError)
        }
      } else {
        handleError(results.message, apiKeyManager, tinypng.bind(null, file, apiKeyManager, cb), () => cb(file.contents));
      }
    } catch (error) {
        handleError(error.response.data.message, apiKeyManager, tinypng.bind(null, file, apiKeyManager, cb), () => cb(file.contents)); // 错误情况下调用检查API Key的函数
    }
  }

// 处理错误信息：api调用或者是文件压缩的错误信息
async function handleError(errorMsg, apiKeyManager, tryNextKeyCb, skipFileCb) {
    // key 错误信息
    const keyErrorList = [
      'Credentials are invalid.', // apiKey 无效
      'Your monthly limit has been exceeded.', // 已超本月免费的 500 张限制
    ];
    if (keyErrorList.includes(errorMsg)) {
      if (apiKeyManager.nextKey()) {
        tryNextKeyCb(); // 使用更新后的API Key重试压缩
      } else {
        clearInterval(intervalId)
      }
    } else {
      console.log('[error] : 文件不可压缩 - ', errorMsg);
      skipFileCb();
    }
  }

// 主函数
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

    }

    return through.obj(async function (file, enc, callback) {
        if (file.isStream()) {
            console.error(SCRIPT_NAME, 'Stream is not supported')
        } else if (file.isNull()) {
            this.push(file)
            return callback()
        } else if (file.isBuffer()) { // 正常处理的类型
            if (_createMd5FormOrigin) { // 不进行压缩操作，只生成现有图片的 md5 信息，并作为缓存。只会在接入本项目时用一次。
              md5RecordList.push(md5(file.contents)) // 记录到缓存中
              this.push(file)
              return callback()
            }
      
            // 目标文件在缓存中存在，且内容未发生变化
            if (_md5RecordFilePath && md5RecordList.indexOf(md5(file.contents)) > -1) {
              this.push(file)
              return callback()
            }
      
            currentFileName = file.relative // 设置压缩中的图片名
            let prevSize = file.contents.length // 压缩前的大小
            if(!prevSize){
              console.log(`${currentFileName} 文件信息错误，无法获取文件大小，跳过压缩`)
              return callback()
            }

            await tinypng(file, apiKeyManager, (data) => {
                const compressPercent = (1 - data.length / prevSize) * 100// 压缩百分比
                const compressPercentStr = compressPercent.toFixed(0) + '%' // 压缩百分比
                if (compressPercent < _minCompressPercentLimit) { // 无效压缩，保存源文件
                  md5RecordList.push(md5(file.contents)) // 记录到缓存中
                  console._log(`压缩比例低于安全线，保存源文件: ${file.relative} 【${compressPercentStr}】`)
                } else { // 有效压缩
                  file.contents = data
                  compressionInfo.num++
                  compressionInfo.saveSize += prevSize - data.length
                  compressionInfo.originSize += prevSize
                  md5RecordList.push(md5(data)) // 记录到缓存中
                  let record = '压缩成功  '
                  record += `前: ${prettyBytes(prevSize)}`.padEnd(15)
                  record += `后: ${prettyBytes(data.length)}`.padEnd(15)
                  record += `压缩: ${prettyBytes(prevSize - data.length)}`.padEnd(18)
                  record += `压缩百分比: ${((prevSize - data.length) / (prevSize || 1) * 100).toFixed(2)}%`.padEnd(18)
                  record += `${file.relative} `
                  recordList.push(record)
                  console._log(record)
                }
                this.push(file)
                recordResult()
                return callback()
            })
        }
    }, function () { // 遍历完成，退出
        clearInterval(intervalId)
    })
}

module.exports = main