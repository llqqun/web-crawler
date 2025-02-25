const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const url = require('url');

async function downloadImage(imageUrl, fileName) {
    try {
        const response = await axios({
            url: imageUrl,
            responseType: 'arraybuffer'
        });
        
        // 创建 images 文件夹（如果不存在）
        if (!fs.existsSync('./images')) {
            fs.mkdirSync('./images');
        }
        
        // 保存图片
        const filePath = path.join('./images', fileName);
        fs.writeFileSync(filePath, response.data);
        console.log(`已下载: ${fileName}`);
    } catch (error) {
        console.error(`下载失败 ${imageUrl}: ${error.message}`);
    }
}

async function crawlImages(websiteUrl) {
    try {
        // 获取网页内容
        const response = await axios.get(websiteUrl);
        const $ = cheerio.load(response.data);
        
        // 查找所有图片标签
        $('img').each(async (i, element) => {
            const imageUrl = $(element).attr('src');
            if (!imageUrl) return;
            
            // 获取完整的图片URL
            const absoluteUrl = url.resolve(websiteUrl, imageUrl);
            
            // 从URL中提取文件名
            let fileName = path.basename(imageUrl);
            
            // 如果URL中没有文件名，使用索引作为文件名
            if (!fileName || !fileName.match(/\.(jpg|jpeg|png|gif)$/i)) {
                fileName = `image_${i}.jpg`;
            }
            
            // 下载图片
            await downloadImage(absoluteUrl, fileName);
        });
        
    } catch (error) {
        console.error(`爬取失败: ${error.message}`);
    }
}

// 使用示例
const targetWebsite = 'https://www.wnacg.com/photos-slide-aid-285308.html'; // 替换为你想爬取的网站
crawlImages(targetWebsite);