# nbt2gltf

Convert Minecraft .nbt files to .gltf 3D models.

## Installation

```bash
npm install nbt2gltf
```

## Usage

```javascript
import { convertNbtToGltf } from 'nbt2gltf'
import { promises as fs } from 'fs'

// Convert NBT file to GLTF
const nbtBuffer = await fs.readFile('my_structure.nbt')

// Option 1: Get GLTF data object
const gltfData = await convertNbtToGltf(nbtBuffer)

// Option 2: Save directly to file
const filePath = await convertNbtToGltf(nbtBuffer, {
  outputPath: './output',
  fileName: 'my_structure.gltf'
})
```

## Requirements

- Node.js >= 16.0.0
- OpenGL support for rendering

## License

MIT
