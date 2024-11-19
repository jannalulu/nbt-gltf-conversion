# Project Overview
Do not run commands in this codebase, ever. 

This codebase converts a Minecraft .nbt to a .gltf file. We need to use version 1.20.1.

prismarine-viewer is also in this repo, so you may reference how the code is run there.

Do not edit files in prismarine-viewer folder; they are read-only.

# Important Implementation Details
- When converting NBT to GLTF, verify the scene contains actual geometry before export. Empty scenes with only lighting indicate issues with structure data processing or rendering pipeline.
- The full pipeline requires:
  1. Proper NBT structure parsing
  2. Converting blocks to world geometry
  3. Waiting for chunk rendering
  4. Verifying geometry exists before GLTF export

# Common Issues
- Empty GLTF output usually means structure data wasn't properly converted to renderable geometry
- Lighting-only scenes indicate the world view initialization succeeded but geometry processing failed

# GLTF Export Requirements
- GLTF exporter only supports directional, point, and spot lights
- Ambient lights must be removed or converted before export
- Light targets should be children of their lights with position 0,0,-1 for best results

# Debugging Steps
- Verify blocks are loaded into world correctly by checking world.getBlock()
- Ensure chunks are fully rendered before export by using viewer.waitForChunksToRender()
- Check scene.children for meshes before export
- If meshes are missing, verify worldView initialization and chunk loading completed successfully

# Mesh Generation Requirements
- Blocks must be fully loaded and resolved (not pending promises) before chunk generation
- World must be initialized with proper chunk boundaries aligned to structure size
- Textures must be loaded before mesh generation can begin
- Chunks must be properly initialized and registered with worldView
- Verify mesh generation by checking viewer.world.sectionMeshs after chunk loading
