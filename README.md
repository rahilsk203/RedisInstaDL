```markdown
# Instagram Media Downloader API

A high-performance API service to download Instagram media (videos and convert to MP3) with caching, rate limiting, and Cloudinary integration.

## Features

- 🎥 Download Instagram videos in MP4 format
- 🔊 Convert Instagram videos to MP3 format
- ⚡ Redis caching for faster repeated requests
- 🔒 Rate limiting to prevent abuse
- ☁️ Temporary Cloudinary storage for MP3 files
- 📊 Request statistics tracking
- 📝 Detailed logging with Winston

## Prerequisites

- Node.js v14+
- Redis server
- FFmpeg installed system-wide
- Cloudinary account
- Instagram URL (public accounts only)

## Installation

1. Clone the repository:
```bash
git clone https://github.com/rahilsk203/instadl.git
cd instagram-downloader-api
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables (create `.env` file):
```env
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
REDIS_URL=your_redis_url
```

4. Start the server:
```bash
npm start
```

## API Reference

### POST /api/download
Download Instagram media as MP4 or MP3

**Request Body:**
```json
{
  "url": "https://www.instagram.com/p/CxampleUrl/",
  "format": "mp4"
}
```

**Successful Response:**
```json
{
  "format": "mp3",
  "url": "https://res.cloudinary.com/video/upload/v123/example.mp3",
  "thumbnail": "https://example.com/thumbnail.jpg"
}
```

### GET /api/stats
Get total requests count

**Response:**
```json
{
  "total_requests": 42
}
```

## Usage Examples

### cURL Request
```bash
curl -X POST http://localhost:3000/api/download \
  -H "Content-Type: application/json" \
  -d '{"url":"https://www.instagram.com/p/CxampleUrl/", "format":"mp3"}'
```

### JavaScript Fetch
```javascript
fetch('http://localhost:3000/api/download', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({
    url: 'https://www.instagram.com/p/CxampleUrl/',
    format: 'mp4'
  })
})
```

## Rate Limiting
- 100 requests per 15 minutes per IP address
- 429 status code for exceeded limits

## Caching Strategy
- MP4 URLs cached for 2 minutes
- MP3 files stored in Cloudinary with auto-deletion after 1 minute
- Redis-based request counting

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## License

Distributed under the MIT License. See `LICENSE` for more information.

## Disclaimer

This project is for educational purposes only. Use it responsibly and in compliance with Instagram's terms of service. The developers are not responsible for any misuse of this API.
```
