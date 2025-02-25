const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const AdmZip = require('adm-zip');

const config = {
  filterPathIndex: 5,
  imgEleBox: '#img_list img',
  autoScrollHeight: 400,
  autoScrollDelay: 80,
  maxScrollTime: 99999999,
  targetWebSite: ''
};

async function downloadImage(imageUrl, fileName) {
  try {
    const response = await axios({
      url: imageUrl,
      responseType: 'arraybuffer',
    });

    if (!fs.existsSync('./images')) {
      fs.mkdirSync('./images');
    }

    const filePath = path.join('./images', fileName);
    fs.writeFileSync(filePath, response.data);
    console.log(`已下载: ${fileName}`);
  } catch (error) {
    console.error(`下载失败 ${imageUrl}: ${error.message}`);
  }
}

async function crawlImages(websiteUrl, selector = 'img') {
  const browser = await puppeteer.launch({
    headless: false,
    // 添加以下配置
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', // Chrome 浏览器路径
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-notifications', // 禁用通知
      '--disable-error-reporting', // 禁用错误报告
    ],
  });

  try {
    const page = await browser.newPage();
    // 设置请求拦截
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      if (
        request.resourceType() === 'image' ||
        request.resourceType() === 'document' ||
        request.resourceType() === 'script' ||
        request.resourceType() === 'xhr' ||
        request.resourceType() === 'fetch'
      ) {
        request.continue();
      } else {
        request.abort();
      }
    });
    // 忽略特定的控制台错误
    page.on('console', (msg) => {
      if (msg.type() === 'error' && msg.text().includes('New Relic')) {
        return;
      }
      console.log('页面日志:', msg.text());
    });

    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'
    );
    await page.setViewport({ width: 1920, height: 1080 });
    page.on('console', (msg) => console.log('页面日志:', msg.text()));
    page.on('pageerror', (err) => console.log('页面错误:', err.message));
    await page
      .goto(websiteUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      })
      .catch((e) => console.log('页面加载超时，继续执行后续步骤'));

    const rawTitle = await page.title();
    const pageTitle = rawTitle
      .split('-')[0] // 获取第一个破折号前的内容
      .trim() // 去除首尾空格
      .replace(/[\\/:*?"<>|]/g, '_') // 替换Windows文件名不允许的字符
      .replace(/\s+/g, '_');
    console.log('等待目标元素加载', pageTitle);
    await page.waitForSelector(selector, { visible: true, timeout: 8000 });
    console.log('找到目标元素');

    await autoScroll(page, config);

    // 修改图片选择器，支持特定class下的图片
    const images = await page.evaluate(
      (selector, config) => {
        const imgElements = document.querySelectorAll(selector);
        console.log('找到图片数量:', imgElements.length);
        const results = [];
        let imgFormat = '';
        Array.from(imgElements).forEach((img, index) => {
          const url = img.src || img.dataset.src || img.dataset.original || img.dataset.lazySrc;
          if (index === 0) {
            results.push({ url, index });
            imgFormat = url.split('/').slice(0, config.filterPathIndex).join('/');
            return;
          }
          const urlParts = url.split('/');
          // 比较路径的最后两部分是否有交集
          const currentEnd = urlParts.slice(0, config.filterPathIndex).join('/');
          if (currentEnd === imgFormat) {
            results.push({ url, index });
          }
        });
        return results.filter((item) => item.url);
      },
      selector,
      config
    );
    console.log('下载列表', images);
    console.log('下载数量', images.length);

    const zip = new AdmZip();
    // 下载图片
    for (let [index, image] of images.entries()) {
      if (!image.url) continue;

      let fileName = path.basename(image.url);
      if (!fileName || !fileName.match(/\.(jpg|jpeg|png|gif)$/i)) {
        fileName = `lq_${index}.jpg`;
      }

      await downloadImage(image.url, fileName);

      // 添加到压缩包
      const filePath = path.join('./images', fileName);
      if (fs.existsSync(filePath)) {
        const fileContent = fs.readFileSync(filePath);
        zip.addFile(fileName, fileContent);
        console.log(`已添加到压缩包: ${fileName}`);
      }
    }

    // 生成压缩包
    const zipName = `${pageTitle}_${Date.now()}.zip`;
    zip.writeZip(zipName);
    console.log(`已生成压缩包: ${zipName}`);

    // 清理临时文件夹
    if (fs.existsSync('./images')) {
      fs.readdirSync('./images').forEach((file) => {
        fs.unlinkSync(path.join('./images', file));
      });
      fs.rmdirSync('./images');
    }
  } catch (error) {
    console.error(`爬取失败: ${error.message}`);
  } finally {
    await browser.close();
  }
}

// 自动滚动页面的函数
async function autoScroll(page, config) {
  try {
    await page.evaluate(async (config) => {
      await new Promise((resolve) => {
        let totalHeight = 0;
        const distance = config.autoScrollHeight;
        const startTime = Date.now();
        const timer = setInterval(() => {
          const scrollHeight = document.documentElement.scrollHeight;
          window.scrollBy(0, distance);
          totalHeight += distance;

          const images = document.querySelectorAll(config.imgEleBox);
          let allLoaded = true;
          let loadedCount = 0;
          images.forEach((img) => {
            if (img.complete) {
              loadedCount++;
            } else {
              allLoaded = false;
            }
          });
          if (Date.now() - startTime > config.maxScrollTime) {
            console.log('滚动超时，继续执行');
            clearInterval(timer);
            resolve();
            return;
          }
          if (totalHeight >= scrollHeight && allLoaded) {
            // 额外等待一段时间确保所有图片都加载完成
            setTimeout(() => {
              clearInterval(timer);
              resolve();
            }, 2000);
          }
          if (totalHeight >= scrollHeight) {
            clearInterval(timer);
            resolve();
          }
        }, config.autoScrollDelay);
      });
    }, config);
  } catch (error) {
    console.log('自动滚动出错，继续执行：', error.message);
  }
}

crawlImages(config.targetWebSite, config.imgEleBox);

// const test = [
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/502.jpg",
//         "index": 0
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/503.jpg",
//         "index": 1
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/504.jpg",
//         "index": 2
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/505.jpg",
//         "index": 3
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/506.jpg",
//         "index": 4
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/507.jpg",
//         "index": 5
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/508.jpg",
//         "index": 6
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/509.jpg",
//         "index": 7
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/510.jpg",
//         "index": 8
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/511.jpg",
//         "index": 9
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/512.jpg",
//         "index": 10
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/513.jpg",
//         "index": 11
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/514.jpg",
//         "index": 12
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/515.jpg",
//         "index": 13
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/516.jpg",
//         "index": 14
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/517.jpg",
//         "index": 15
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/518.jpg",
//         "index": 16
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/519.jpg",
//         "index": 17
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/520.jpg",
//         "index": 18
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/521.jpg",
//         "index": 19
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/522.jpg",
//         "index": 20
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/523.jpg",
//         "index": 21
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/524.jpg",
//         "index": 22
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/525.jpg",
//         "index": 23
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/526.jpg",
//         "index": 24
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/527.jpg",
//         "index": 25
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/528.jpg",
//         "index": 26
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/529.jpg",
//         "index": 27
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/530.jpg",
//         "index": 28
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/531.jpg",
//         "index": 29
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/532.jpg",
//         "index": 30
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/533.jpg",
//         "index": 31
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/534.jpg",
//         "index": 32
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/535.jpg",
//         "index": 33
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/536.jpg",
//         "index": 34
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/537.jpg",
//         "index": 35
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/538.jpg",
//         "index": 36
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/539.jpg",
//         "index": 37
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/540.jpg",
//         "index": 38
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/541.jpg",
//         "index": 39
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/542.jpg",
//         "index": 40
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/543.jpg",
//         "index": 41
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/544.jpg",
//         "index": 42
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/545.jpg",
//         "index": 43
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/546.jpg",
//         "index": 44
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/547.jpg",
//         "index": 45
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/548.jpg",
//         "index": 46
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/549.jpg",
//         "index": 47
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/550.jpg",
//         "index": 48
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/551.jpg",
//         "index": 49
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/552.jpg",
//         "index": 50
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/553.jpg",
//         "index": 51
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/554.jpg",
//         "index": 52
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/555.jpg",
//         "index": 53
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/556.jpg",
//         "index": 54
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/557.jpg",
//         "index": 55
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/558.jpg",
//         "index": 56
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/559.jpg",
//         "index": 57
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/560.jpg",
//         "index": 58
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/561.jpg",
//         "index": 59
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/562.jpg",
//         "index": 60
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/563.jpg",
//         "index": 61
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/564.jpg",
//         "index": 62
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/565.jpg",
//         "index": 63
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/566.jpg",
//         "index": 64
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/567.jpg",
//         "index": 65
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/568.jpg",
//         "index": 66
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/569.jpg",
//         "index": 67
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/570.jpg",
//         "index": 68
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/571.jpg",
//         "index": 69
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/572.jpg",
//         "index": 70
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/573.jpg",
//         "index": 71
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/574.jpg",
//         "index": 72
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/575.jpg",
//         "index": 73
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/576.jpg",
//         "index": 74
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/577.jpg",
//         "index": 75
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/578.jpg",
//         "index": 76
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/579.jpg",
//         "index": 77
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/580.jpg",
//         "index": 78
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/581.jpg",
//         "index": 79
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/582.jpg",
//         "index": 80
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/583.jpg",
//         "index": 81
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/584.jpg",
//         "index": 82
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/585.jpg",
//         "index": 83
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/586.jpg",
//         "index": 84
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/587.jpg",
//         "index": 85
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/588.jpg",
//         "index": 86
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/589.jpg",
//         "index": 87
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/590.jpg",
//         "index": 88
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/591.jpg",
//         "index": 89
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/592.jpg",
//         "index": 90
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/593.jpg",
//         "index": 91
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/594.jpg",
//         "index": 92
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/595.jpg",
//         "index": 93
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/596.jpg",
//         "index": 94
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/597.jpg",
//         "index": 95
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/598.jpg",
//         "index": 96
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/599.jpg",
//         "index": 97
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/600.jpg",
//         "index": 98
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/601.jpg",
//         "index": 99
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/602.jpg",
//         "index": 100
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/603.jpg",
//         "index": 101
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/604.jpg",
//         "index": 102
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/605.jpg",
//         "index": 103
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/606.jpg",
//         "index": 104
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/607.jpg",
//         "index": 105
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/608.jpg",
//         "index": 106
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/609.jpg",
//         "index": 107
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/610.jpg",
//         "index": 108
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/611.jpg",
//         "index": 109
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/612.jpg",
//         "index": 110
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/613.jpg",
//         "index": 111
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/614.jpg",
//         "index": 112
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/615.jpg",
//         "index": 113
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/616.jpg",
//         "index": 114
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/617.jpg",
//         "index": 115
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/618.jpg",
//         "index": 116
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/619.jpg",
//         "index": 117
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/620.jpg",
//         "index": 118
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/621.jpg",
//         "index": 119
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/622.jpg",
//         "index": 120
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/623.jpg",
//         "index": 121
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/624.jpg",
//         "index": 122
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/625.jpg",
//         "index": 123
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/626.jpg",
//         "index": 124
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/627.jpg",
//         "index": 125
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/628.jpg",
//         "index": 126
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/629.jpg",
//         "index": 127
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/630.jpg",
//         "index": 128
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/631.jpg",
//         "index": 129
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/632.jpg",
//         "index": 130
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/633.jpg",
//         "index": 131
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/634.jpg",
//         "index": 132
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/635.jpg",
//         "index": 133
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/636.jpg",
//         "index": 134
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/637.jpg",
//         "index": 135
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/638.jpg",
//         "index": 136
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/639.jpg",
//         "index": 137
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/640.jpg",
//         "index": 138
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/641.jpg",
//         "index": 139
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/642.jpg",
//         "index": 140
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/643.jpg",
//         "index": 141
//     },
//     {
//         "url": "https://img5.qy0.ru/data/2853/08/644.jpg",
//         "index": 142
//     },
//     {
//         "url": "https://www.wnacg.com/themes/weitu/images/bg/shoucang.jpg",
//         "index": 143
//     }
// ]
// test.forEach(item => {
//     item.index = 502 + item.index
// })


// async function demo () {
//     for (let { url, index } of test) {
//         if (!url) continue;
    
//         let fileName = path.basename(url);
//         if (!fileName || !fileName.match(/\.(jpg|jpeg|png|gif)$/i)) {
//           fileName = `lq_${index}.jpg`;
//         }
    
//         await downloadImage(url, fileName);
    
//       }
// }
// demo()
