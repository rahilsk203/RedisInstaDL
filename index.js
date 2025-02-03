const express = require('express');
const { igdl } = require('btch-downloader');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const Redis = require('ioredis');
const { v4: uuidv4 } = require('uuid');
const rateLimit = require('express-rate-limit');
const winston = require('winston');
const cloudinary = require('cloudinary').v2;
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = 3000;

// Configure Winston logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' }),
  ],
});

// Redis for caching and request counting
const redis = new Redis('redis:/127.0.0.1:6379');
redis.on('error', (err) => {
  logger.error('Redis error:', err);
});

// Cloudinary configuration (use environment variables in production)
cloudinary.config({
  cloud_name: 'ENTER',
  api_key: 'ENTER',
  api_secret: 'ENTER',
});

// Middleware to parse JSON
app.use(express.json());

// CORS configuration
const allowedOrigins = [
  'http://localhost:8080', // Frontend origin
  'https://exmple.com', // Your blog domain
];

const corsOptions = {
  origin: (origin, callback) => {
    if (allowedOrigins.includes(origin) || !origin) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
  credentials: true,
};

app.use(cors(corsOptions));

// Rate limiting middleware
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  handler: (req, res) => {
    res.status(429).json({ error: 'Too many requests, please try again later' });
  },
});
app.use('/api/download', limiter);

// Middleware to count requests
async function countRequests(req, res, next) {
  try {
    const totalRequests = await redis.incr('total_requests');
    logger.info(`Total requests: ${totalRequests}`);
    next();
  } catch (err) {
    logger.error('Failed to count requests:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// Function to upload file to Cloudinary
async function uploadToCloudinary(filePath, resourceType = 'auto') {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      { resource_type: resourceType },
      (error, result) => {
        if (error) {
          reject(new Error('Failed to upload file to Cloudinary'));
        } else {
          resolve(result);
        }
      }
    );

    // Create a readable stream from the file
    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(uploadStream);
  });
}

// Function to delete file from Cloudinary
async function deleteFromCloudinary(publicId, resourceType = 'video') {
  return new Promise((resolve, reject) => {
    cloudinary.uploader.destroy(publicId, { resource_type: resourceType }, (error, result) => {
      if (error) {
        reject(new Error('Failed to delete file from Cloudinary'));
      } else {
        resolve(result);
      }
    });
  });
}

// Function to download video from URL
async function downloadVideo(videoUrl, tempFilePath) {
  return new Promise((resolve, reject) => {
    const videoStream = fs.createWriteStream(tempFilePath);
    axios({
      method: 'get',
      url: videoUrl,
      responseType: 'stream',
    })
      .then((response) => {
        response.data.pipe(videoStream);
        videoStream.on('finish', resolve);
        videoStream.on('error', reject);
      })
      .catch((error) => {
        reject(new Error('Failed to download video'));
      });
  });
}

// Function to convert video to MP3
async function convertToMp3(videoPath, mp3Path) {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .output(mp3Path)
      .audioBitrate(128)
      .on('end', resolve)
      .on('error', reject)
      .run();
  });
}

// Public API route for downloading Instagram content
app.post('/api/download', countRequests, async (req, res) => {
  const { url, format } = req.body;

  if (!url || !format) {
    return res.status(400).json({ error: 'URL and format are required' });
  }

  // Validate Instagram URL
  const instagramUrlRegex = /https?:\/\/(www\.)?instagram\.com\/.*/;
  if (!instagramUrlRegex.test(url)) {
    return res.status(400).json({ error: 'Invalid Instagram URL' });
  }

  // Validate format
  if (!['mp4', 'mp3'].includes(format)) {
    return res.status(400).json({ error: 'Unsupported format' });
  }

  try {
    // Encode the URL and include the format in the Redis key
    const encodedKey = `instagram:${encodeURIComponent(url)}:${format}`;

    // Check if the file is already cached in Redis
    const cachedData = await redis.get(encodedKey);
    if (cachedData) {
      // Parse the cached data (if it's a JSON string)
      const cachedResult = JSON.parse(cachedData);
      logger.info('Returning cached file:', cachedResult.url); // Log the cached URL
      return res.json({ format, url: cachedResult.url, thumbnail: cachedResult.thumbnail });
    }

    // If no cached data, fetch new data using btch-downloader
    const data = await igdl(url);
    if (!data || !data[0] || !data[0].url) {
      throw new Error('No media found for the provided URL');
    }

    // Extract video URL and thumbnail URL (if available)
    const videoUrl = data[0].url;
    const thumbnailUrl = data[0].thumbnail || null;

    if (format === 'mp4') {
      // Cache the video URL and thumbnail in Redis with a 2-minute expiration
      const cacheValue = JSON.stringify({ url: videoUrl, thumbnail: thumbnailUrl });
      await redis.set(encodedKey, cacheValue, 'EX', 60); // 120 seconds = 2 minutes
      logger.info(`Cached video URL in Redis: ${encodedKey}`);

      // Directly return the video URL to the user
      return res.json({ format: 'mp4', url: videoUrl, thumbnail: thumbnailUrl });
    } else if (format === 'mp3') {
      // For MP3, proceed with downloading, converting, and uploading to Cloudinary
      const tempFilePath = path.join(__dirname, `${uuidv4()}.mp4`);
      const mp3FilePath = path.join(__dirname, `${uuidv4()}.mp3`);

      try {
        await downloadVideo(videoUrl, tempFilePath);
        await convertToMp3(tempFilePath, mp3FilePath);

        // Upload MP3 to Cloudinary
        const uploadResult = await uploadToCloudinary(mp3FilePath, 'video');
        const cloudinaryUrl = uploadResult.secure_url;
        const publicId = uploadResult.public_id;

        // Cache the Cloudinary URL and public_id in Redis with a 2-minute expiration
        const cacheValue = JSON.stringify({ url: cloudinaryUrl, thumbnail: thumbnailUrl, publicId });
        await redis.set(encodedKey, cacheValue, 'EX', 120); // 120 seconds = 2 minutes
        logger.info(`Cached file in Redis: ${encodedKey}, publicId: ${publicId}`);

        // Send the MP3 URL to the user
        res.json({ format: 'mp3', url: cloudinaryUrl, thumbnail: thumbnailUrl });

        // Delete temporary files
        fs.unlinkSync(tempFilePath);
        fs.unlinkSync(mp3FilePath);
        logger.info('Temporary files deleted:', tempFilePath, mp3FilePath);

        // Delete the MP3 from Cloudinary after 1 minute (adjust as needed)
        setTimeout(async () => {
          try {
            await deleteFromCloudinary(publicId, 'video');
            logger.info(`Deleted MP3 from Cloudinary: ${publicId}`);
          } catch (error) {
            logger.error('Failed to delete MP3 from Cloudinary:', error);
          }
        }, 60 * 1000); // 1 minute delay
      } catch (error) {
        // Clean up temporary files if an error occurs
        if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
        if (fs.existsSync(mp3FilePath)) fs.unlinkSync(mp3FilePath);
        throw error;
      }
    }
  } catch (error) {
    logger.error('Error:', error);
    res.status(500).json({ error: error.message || 'Failed to process the URL' });
  }
});

// Admin route to view total request count
app.get('/api/stats', async (req, res) => {
  try {
    const totalRequests = await redis.get('total_requests');
    res.json({ total_requests: totalRequests || 0 });
  } catch (err) {
    logger.error('Failed to fetch stats:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Start the server
app.listen(PORT, () => {
  logger.info(`Server is running on http://localhost:${PORT}`);
});
