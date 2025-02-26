const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const AdmZip = require('adm-zip');

const config = {
  filterPathIndex: 5,
  imgEleBox: '#img_list img',
  autoScrollHeight: 300,
  autoScrollDelay: 100,
  maxScrollTime: 600000,
  domTime: 600000,
  fileSave: 'dist',
  imgCache: 'cache',
  clearCache: true,
  loadType: 'networkidle2', // domcontentloaded load networkidle0 networkidle2
  targetWebSite: 'https://www.wnacg.com/photos-slide-aid-284087.html',
};

async function downloadImage(imageUrl, fileName) {
  try {
    const response = await axios({
      url: imageUrl,
      responseType: 'arraybuffer',
    });
    const rootPath = `./${config.imgCache}`;
    if (!fs.existsSync(rootPath)) {
      fs.mkdirSync(rootPath);
    }

    const filePath = path.join(rootPath, fileName);
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
        waitUntil: config.loadType,
        timeout: config.domTime,
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
    if (config.clearCache && fs.existsSync(`./${config.imgCache}`)) {
      fs.readdirSync(`./${config.imgCache}`).forEach((file) => {
        fs.unlinkSync(path.join(`./${config.imgCache}`, file));
      });
      fs.rmdirSync(`./${config.imgCache}`);
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

// 长图补救
// 浏览器控制台执行
// const imgElements = document.querySelectorAll(selector);
// const results = [];
// Array.from(imgElements).forEach((img, index) => {
//   const url = img.src || img.dataset.src || img.dataset.original || img.dataset.lazySrc;
//   results.push({ url, index });
// });
// results = results.filter((item) => item.url);
// results.forEach((item) => {
//   item.index = 502 + item.index;
// });
// // node执行
// async function demo() {
//   for (let { url, index } of results) {
//     if (!url) continue;

//     let fileName = path.basename(url);
//     if (!fileName || !fileName.match(/\.(jpg|jpeg|png|gif)$/i)) {
//       fileName = `lq_${index}.jpg`;
//     }

//     await downloadImage(url, fileName);
//   }
// }
// demo();
