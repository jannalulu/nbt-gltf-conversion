This is a project to convert a .nbt file from minecraft to a functional .gltf. 

The dimensions of a Minecraft block are 16x16x16 pixels. In the texture atlas, the UV coordinates span from (0, 0) to (1, 1). 


# Implementation Strategy
- Prefer using established Minecraft rendering solutions over custom implementations. Do not create special mappings for lanterns specifically, for example. 
- Special blocks require complete model structure understanding, not just texture mapping
- Block models may use multiple geometries and nested elements
- UV mapping alone cannot fix rendering - must match Minecraft's model structure


# Implementation Strategy
- Prefer using established Minecraft rendering solutions over custom implementations. Do not create special mappings for lanterns specifically, for example. 
- Special blocks require complete model structure understanding, not just texture mapping
- Block models may use multiple geometries and nested elements
- UV mapping alone cannot fix rendering - must match Minecraft's model structure

# Block Model Structure
- All blocks use the same model loading system - no special cases needed
- Model definitions in blocks_models.json fully specify geometry and UV mapping
- Complex blocks like lanterns use compound models with multiple elements
- Grass blocks combine two distinct models (dirt base + grass overlay)
- Model structure must be loaded before applying textures
- Reference Minecraft's model json files for correct structure
- Model inheritance rules:
  - Child models completely override parent elements when specified
  - Parent elements only used if child has none
  - Textures merge additively - child textures override parent's
  - Each model variant (e.g. stairs, lantern) needs unique inheritance chain
- Coordinate system is critical:
  - Minecraft uses 16x16x16 block space
  - Must convert to 0-1 space exactly once
  - Scaling must happen in model loader, not renderer
  - All transformations (rotation, translation) must happen in same coordinate space
  - Texture atlas UV coordinates:
    - Atlas spans (0,0) to (1,1)
    - Block textures are mapped to specific regions
    - UV coordinates in geometry must match atlas regions exactly

# Block Model Structure
- Complex blocks like lanterns use compound models with multiple elements
- Model structure in blocks_models.json must be followed exactly - no shortcuts
- Each element's geometry, rotation, and UV mapping must match model specification
- Do not attempt to simplify complex models into basic geometries
- Grass blocks combine two distinct models (dirt base + grass overlay)
- Model structure must be loaded before applying textures
- Reference Minecraft's model json files for correct structure

# Texture Handling
- Texture paths must exactly match Minecraft's format (minecraft:block/, minecraft:item/, etc) 
- Special block textures have stricter atlas layout requirements than regular blocks
- Always check blocks_models.json for exact UV coordinates - don't assume standard block spacing
- Texture resolution order: specific texture (e.g. lantern) > general texture (all, texture) > fallback (particle)
- Reference prismarine-viewer's model/entity handling code for complex cases
- Images location is strict: blocks/, items/, or entity/ directories - never mixed

# Model Variants
- Blocks may require multiple model variants:
  - Beds: _head, _foot, _north variants
  - Glass panes: _post and _side variants
  - Doors: _bottom, _top, _left, _right variants
- Model lookup must try multiple name patterns:
  - Raw name (e.g. "lantern")
  - With block/ prefix
  - With variant suffixes
  - Without minecraft: prefix
- Glass panes need special geometry and transparency
  - Requires both post and side geometries
  - Must handle transparency in material settings
  - Geometry must be properly oriented for connected textures
  - Models must be found via _post and _side variants
  - Verify pane texture key exists in texture mapping


# Texture Reference Format
Here's some of the json files in mine-craft assets that may be useful.
Some notes:

Note that barrier.png is stored in /items, not item. 
  "barrier": {
    "textures": {
      "particle": "minecraft:item/barrier"
    }
  },

The images are either in blocks/ or items/ or entity/, not in both.

<blocks_models.json>   "basalt": {     "parent": "minecraft:block/cube_column",     "textures": {       "end": "minecraft:block/basalt_top",       "side": "minecraft:block/basalt_side"     }   },</blocks_models.json>

<blocks_textures.json>
  {     "name": "stone",     "blockState": "stone",     "model": "minecraft:blocks/stone",     "texture": "minecraft:blocks/stone"   },</blocks_textures.json> <blocks_states.json>   "honeycomb_block": {     "variants": {       "": {         "model": "minecraft:block/honeycomb_block"       }     }   },</block_states.json>
<items_textures.json>   {     "name": "oak_sapling",     "model": "oak_sapling",     "texture": "minecraft:block/oak_sapling"   },</items_textures.json>

<blocks_models.json>

"lantern": { "parent": "minecraft:block/template_lantern", "textures": { "lantern": "minecraft:block/lantern" } }, "lantern_hanging": { "parent": "minecraft:block/template_hanging_lantern", "textures": { "lantern": "minecraft:block/lantern" } },

"template_lantern": { "parent": "block/block", "textures": { "particle": "#lantern" }, "elements": [ { "from": [ 5, 0, 5 ], "to": [ 11, 7, 11 ], "faces": { "down": { "uv": [ 0, 9, 6, 15 ], "texture": "#lantern", "cullface": "down" }, "up": { "uv": [ 0, 9, 6, 15 ], "texture": "#lantern" }, "north": { "uv": [ 0, 2, 6, 9 ], "texture": "#lantern" }, "south": { "uv": [ 0, 2, 6, 9 ], "texture": "#lantern" }, "west": { "uv": [ 0, 2, 6, 9 ], "texture": "#lantern" }, "east": { "uv": [ 0, 2, 6, 9 ], "texture": "#lantern" } } }, { "from": [ 6, 7, 6 ], "to": [ 10, 9, 10 ], "faces": { "up": { "uv": [ 1, 10, 5, 14 ], "texture": "#lantern" }, "north": { "uv": [ 1, 0, 5, 2 ], "texture": "#lantern" }, "south": { "uv": [ 1, 0, 5, 2 ], "texture": "#lantern" }, "west": { "uv": [ 1, 0, 5, 2 ], "texture": "#lantern" }, "east": { "uv": [ 1, 0, 5, 2 ], "texture": "#lantern" } } }, { "from": [ 6.5, 9, 8 ], "to": [ 9.5, 11, 8 ], "rotation": { "origin": [ 8, 8, 8 ], "axis": "y", "angle": 45 }, "shade": false, "faces": { "north": { "uv": [ 14, 1, 11, 3 ], "texture": "#lantern" }, "south": { "uv": [ 11, 1, 14, 3 ], "texture": "#lantern" } } }, { "from": [ 8, 9, 6.5 ], "to": [ 8, 11, 9.5 ], "rotation": { "origin": [ 8, 8, 8 ], "axis": "y", "angle": 45 }, "shade": false, "faces": { "west": { "uv": [ 14, 10, 11, 12 ], "texture": "#lantern" }, "east": { "uv": [ 11, 10, 14, 12 ], "texture": "#lantern" } } } ] },

"template_hanging_lantern": { "parent": "block/block", "textures": { "particle": "#lantern" }, "elements": [ { "from": [ 5, 1, 5 ], "to": [ 11, 8, 11 ], "faces": { "down": { "uv": [ 0, 9, 6, 15 ], "texture": "#lantern" }, "up": { "uv": [ 0, 9, 6, 15 ], "texture": "#lantern" }, "north": { "uv": [ 0, 2, 6, 9 ], "texture": "#lantern" }, "south": { "uv": [ 0, 2, 6, 9 ], "texture": "#lantern" }, "west": { "uv": [ 0, 2, 6, 9 ], "texture": "#lantern" }, "east": { "uv": [ 0, 2, 6, 9 ], "texture": "#lantern" } } }, { "from": [ 6, 8, 6 ], "to": [ 10, 10, 10 ], "faces": { "down": { "uv": [ 1, 10, 5, 14 ], "texture": "#lantern" }, "up": { "uv": [ 1, 10, 5, 14 ], "texture": "#lantern" }, "north": { "uv": [ 1, 0, 5, 2 ], "texture": "#lantern" }, "south": { "uv": [ 1, 0, 5, 2 ], "texture": "#lantern" }, "west": { "uv": [ 1, 0, 5, 2 ], "texture": "#lantern" }, "east": { "uv": [ 1, 0, 5, 2 ], "texture": "#lantern" } } }, { "from": [ 6.5, 11, 8 ], "to": [ 9.5, 15, 8 ], "rotation": { "origin": [ 8, 8, 8 ], "axis": "y", "angle": 45 }, "shade": false, "faces": { "north": { "uv": [ 14, 1, 11, 5 ], "texture": "#lantern" }, "south": { "uv": [ 11, 1, 14, 5 ], "texture": "#lantern" } } }, { "from": [ 8, 10, 6.5 ], "to": [ 8, 16, 9.5 ], "rotation": { "origin": [ 8, 8, 8 ], "axis": "y", "angle": 45 }, "shade": false, "faces": { "west": { "uv": [ 14, 6, 11, 12 ], "texture": "#lantern" }, "east": { "uv": [ 11, 6, 14, 12 ], "texture": "#lantern" } } } ] },

"block": { "gui_light": "side", "display": { "gui": { "rotation": [ 30, 225, 0 ], "translation": [ 0, 0, 0 ], "scale": [ 0.625, 0.625, 0.625 ] }, "ground": { "rotation": [ 0, 0, 0 ], "translation": [ 0, 3, 0 ], "scale": [ 0.25, 0.25, 0.25 ] }, "fixed": { "rotation": [ 0, 0, 0 ], "translation": [ 0, 0, 0 ], "scale": [ 0.5, 0.5, 0.5 ] }, "thirdperson_righthand": { "rotation": [ 75, 45, 0 ], "translation": [ 0, 2.5, 0 ], "scale": [ 0.375, 0.375, 0.375 ] }, "firstperson_righthand": { "rotation": [ 0, 45, 0 ], "translation": [ 0, 0, 0 ], "scale": [ 0.4, 0.4, 0.4 ] }, "firstperson_lefthand": { "rotation": [ 0, 225, 0 ], "translation": [ 0, 0, 0 ], "scale": [ 0.4, 0.4, 0.4 ] } } },
</blocks_models.json>
<blocks_states.json>"lantern": { "variants": { "hanging=false": { "model": "minecraft:block/lantern" }, "hanging=true": { "model": "minecraft:block/lantern_hanging" } } } </block_states.json>
