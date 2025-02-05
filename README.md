# tingpng-compress
## 学习项目
- [原项目地址](https://github.com/Momo707577045/tinypng-script-with-cache)
  - 在原项目的基础上重构了代码
## 特点
- 【无依赖，纯脚本】
  - 下载脚本代码，直接使用 node 命令即可运行。
  - 将使用门槛降到最低。
- 【过滤重复压缩】
  - 自动记录已被压缩过的图片，跳过压缩，加快进度。
  - 记录图片压缩后的 md5 值，再次运行压缩脚本时，跳过压缩。
  - 通过 md5 值比较文件变更，即使「文件迁移」也能自动过滤。
  - 通过 md5 值比较文件变更，即使「使用同名文件替换」也能自动识别，并压缩，没有漏网之鱼。
- 【替换源文件】
  - 压缩成功，直接替换源文件，不生成冗余文件，不需要复制粘贴，移动图片。
  - 静默压缩，对项目无感知，无任何影响。
- 【自动切换 api key】
  - tinypng 申请的 [api key](https://tinypng.com/developers) 每月只有 500 次免费压缩额度。
  - 可设置多个 api key，当某 key 超过使用次数时，自动切换下一个 key 进行压缩。
- 【压缩报告】
  - 记录每个图片的压缩数据，并生成汇总信息。
- 【压缩安全边界】
  - 压缩安全线，当压缩比例低于该百分比值时，保持源文件，避免过分压缩，损伤图片质量。
- 【源码携带详细备注，自带测试图片】
  - 降低源码阅读门槛，降低测试门槛，减低使用门槛。
  - 推荐阅读源码，打破恐惧，便于定制个性化需求。

## 单文件使用方式
- 第一步，下载打包后的源码：dist/compress-image.js
- 第二步，在脚本文件头部添加 tinypng 的 [api key](https://tinypng.com/developers)
  ```
  global.tinypngConf = {
    apiKeyList: [
      // 'XgNgkoyWbdIZd8OizINMjX2TpxAd_Gp3', // 无效 key
      // 'IAl6s3ekmONUVMEqWZdIp1nV2ItJL1PC', // 无效 key
      'IAl6s3ekmONUVMEqWZdIp1nV2ItJLyPC', // 有效 key
    ]
  };
  ```
  ![配置图](./docs/001.png)
- 第三步，赋予脚本文件「可执行」权限，```chmod +x ./compress-image.js```
- 第四步，将脚本文件放置到项目所在目录
  ![运行效果](./docs/002.png)
- 第五步，在项目所在目录运行脚本```node ./compress-image.js```
- 后续使用，仅需最后两步「第四步」「第五步」


## 参数传递方式
#### 默认配置
- 默认压缩「运行命令所在文件夹」下的图片
- 「命令传参」优先级高于「修改源文件设置」


#### 修改源文件设置
- 在源文件头部，写入全局参数，程序运行时自动获取
- 全部参考配置如下
  ```
  global.tinypngConf = {
     basePath: '/Users/eureka/Desktop/git/tinypng-script-with-cache/test-img', // 压缩路径
     createMd5FormOrigin: false, // 不进行压缩操作，只生成现有图片的 md5 信息，并作为缓存。用于「初次项目接入」及手动清理冗余的「图片md5信息」
     apiKeyList: [ // tiny png 的 api key 数组，当其中一个不可用或超过使用次数时，自动切换下一个 key 调用
       'IAl6s3ekmONUVMEqWZdIp1nV2ItJLyPC', // 有效 key
     ]
   };
  ```
  ![配置图](./docs/001.png)

#### 命令传参
- 参数通过空格区分
- 参数一：压缩路径
- 参数二：是否不进行压缩操作，只生成现有图片的 md5 信息。除空字符串```''```外，其余值均为 true
```bash
node ./compress-image.js [basePath] [createMd5FormOrigin] [apiKeys]
```

| 选项 | 描述 | 默认值 |
|------|------|--------|
| `basePath` | 压缩图片的基础路径 | 当前工作目录 |
| `createMd5FormOrigin` | 是否只生成 MD5 而不压缩 | `false` |
| `apiKeyList` | TinyPNG API Key 列表 | `[]` |

- 传参参考
```bash
node ./compress-image.js ./images false API_KEY1,API_KEY2
```

## 二次开发，生成自定义脚本
- git clone 下载项目
- npm install 安装依赖
- 修改「main.js」与「tinypng-with-cache.js」源文件
- 执行```npx webpack```命令，进行打包
- 生成目标文件```dist/compress-image.js```


## 注意事项
- 请确保您有足够的 TinyPNG API 使用额度。
- 首次运行时，建议先使用 `createMd5FormOrigin` 选项生成 MD5 记录。
- 压缩大量图片可能需要较长时间，请耐心等待。

## 贡献
欢迎提交 Issues 和 Pull Requests 来改进这个项目。


## 运行效果
![运行效果](./docs/003.png)

## 压缩报告
![压缩报告](./docs/report.png)

## md5 记录
![md5 记录](./docs/record.png)