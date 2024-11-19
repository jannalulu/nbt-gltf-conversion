# Project Overview
Do not run commands in this codebase, ever. 

This codebase converts a Minecraft .nbt to a .gltf file. We need to use version 1.20.1.

prismarine-viewer is also in this repo, so you may reference how the code is run there.

Do not edit files in prismarine-viewer folder; they are read-only. They can be helpful for learning how the code is supposed to work.

# Texture System Requirements
- Use prismarine-viewer's texture atlas system for block textures
- Textures must be loaded through the atlas before mesh generation
- Block textures are mapped using blockStates and variants
- Atlas provides UV coordinates for texture mapping
- Do not attempt direct texture loading - use prismarine's utilities
- Test texture loading before mesh generation

## Texture Implementation Debug Steps
1. Verify texture atlas initialization:
   - Atlas must be created before any mesh generation
   - Check atlas.json exists and contains texture mappings
   - Confirm texture paths match version directory structure
2. Debug block texture mapping:
   - Ensure blockStates are loaded and parsed
   - Verify block variants contain valid texture references
   - Check texture coordinates in UV mapping
3. Common texture errors:
   - Undefined array indices often indicate missing texture coordinates
   - Texture loading must complete before mesh generation starts
   - Block positions must align with texture UV coordinates

# GLTF Export Requirements
- GLTF exporter only supports directional, point, and spot lights
- Ambient lights must be removed or converted before export
- Light targets should be children of their lights with position 0,0,-1 for best results
- Requires vblob polyfills (Blob and FileReader) for Node.js environment
- Use Prismarine's native texture support for proper block textures in export
- Use THREE.TextureLoader.load() with callbacks to ensure texture completion
- Consider using Promise.all() for texture loading completion
- Test GLTF export after any material or mesh changes
- Verify all textures are loaded before attempting export

# Mesh Generation
## Requirements
- Blocks must be fully loaded and resolved (not pending promises) before chunk generation
- World must be initialized with proper chunk boundaries aligned to structure size
- Verify mesh generation completed by checking scene.children.filter(c => c.isMesh).length
- Allow sufficient time for chunk loading and mesh generation (5+ seconds)
- Ensure worker is properly initialized (check viewer.world.worker exists)
- Wait for worker to receive and process block states before mesh generation
- Ensure WorldView is properly initialized before mesh generation starts
- Verify chunk loading by checking worldView.loadedChunks count matches expected chunks
- Confirm world columns are populated before attempting mesh generation

## Pipeline
1. Load and parse NBT file
2. Initialize world with blocks
3. Create WorldView with correct view distance and center
4. Wait for chunks to load (check worldView.loadedChunks)
5. Wait for mesh generation worker to process chunks
6. Verify meshes exist before export

# Debugging Guide
## Empty GLTF Exports
1. Check console for mesh count - should be > 0
2. Verify world loading succeeded by checking block counts
3. Ensure chunks are fully rendered before export
4. Check scene.children contains Mesh objects before export

## NBT Processing
- Keep NBT parsing result (parsed) within processNBT scope
- Debug block loading before world initialization
- Verify NBT structure:
  1. Check palette entries match expected block types
  2. Validate block positions within structure bounds
  3. Count non-air blocks before world generation

## Mesh Generation Debug Steps
1. Verify block loading:
   - Check non-air block count in NBT
   - Confirm blocks are being set in world
   - Log block positions and types
2. Verify chunk loading:
   - Confirm chunks are created for structure bounds
   - Check worldView.loadedChunks contains expected chunks
3. Monitor mesh generation:
   - Watch for worker messages about geometry
   - Check viewer.world.sectionMeshs after loading
   - Verify scene.children includes THREE.Mesh objects
4. Common mesh generation failures:
   - Missing block states
   - Chunks not properly initialized
   - Structure position outside loaded chunks
   - Worker not receiving block updates

# Common Issues
- Empty GLTF output usually means structure data wasn't properly converted to renderable geometry
- Lighting-only scenes indicate the world view initialization succeeded but geometry processing failed
- Verify mesh generation by checking viewer.world.sectionMeshs after chunk loading
- Successful mesh generation (non-zero mesh count) doesn't guarantee valid GLTF export - verify scene hierarchy
- Worker initialization failures can manifest as missing meshes - avoid recursive event handling
- Mock workers must handle messages without creating circular references
- Do not modify or remove MockWorker implementation - it's essential for mesh generation
- When adding features (textures, materials), test each step separately:
  1. First verify basic mesh generation still works
  2. Then check render output
  3. Finally test GLTF export
- Add console logging between steps to identify failures
- Keep core export functionality working while adding features