const {createCanvas} = require('canvas')

// generateRandomImage generates a random image with random rectangles.
// Helps us to test image download functionality in integration tests with real images.
const generateRandomImage = () => {
  const width = 800
  const height = 600
  const canvas = createCanvas(width, height)
  const context = canvas.getContext('2d')

  // Fill background with white
  context.fillStyle = 'white'
  context.fillRect(0, 0, width, height)

  // Generate random rectangles
  const rectangleCount = Math.floor(Math.random() * 10) + 5 // 5 to 15 rectangles
  for (let i = 0; i < rectangleCount; i++) {
    const x = Math.floor(Math.random() * width)
    const y = Math.floor(Math.random() * height)
    const w = Math.floor(Math.random() * (width - x)) // width should not exceed canvas width
    const h = Math.floor(Math.random() * (height - y)) // height should not exceed canvas height
    context.fillStyle = `#${Math.floor(Math.random() * 16777215).toString(16)}` // Random hex color
    context.fillRect(x, y, w, h)
  }

  // Convert canvas to Buffer (PNG)
  return canvas.toBuffer()
}

module.exports = {generateRandomImage}
