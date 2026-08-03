---
name: art_character_derivative
description: Character Derivative Asset Generation · Constraint Manual
metaData: art_skills
---

# Character Derivative Asset Generation · Constraint Manual

---

## I. Overlay Principles

1. **Face Unchanged** — Facial features must remain identical to the base model after overlay; no facial deviation allowed
2. **Pose Unchanged** — Maintain natural standing pose from base model; no pose/action/posture changes allowed
3. **Layered Control** — Each layer independently described, enabling layer-by-layer replacement (change outfit without changing makeup)
4. **Style Unity** — All clothing/makeup/hair elements must conform to the same aesthetic system
5. **Quality Not Degraded** — Overlay quality standards must not be lower than base model
6. **Pure Clothing/Makeup Scope** — Only overlay makeup/hairstyle/clothing/accessories; no props, scenes, environments, or actions

---

## II. Overlay Layers

| Layer | Content | Description |
|---|---|---|
| L0 | Base Model | Base character image, unmodified |
| L1 | Makeup (Decision Layer) | Analyze user clues first, then decide makeup intensity: "basic / light / formal" |
| L2 | Hairstyle | Hair updos/tied braids + hair accessories |
| L3 | Inner Garment | Replace white base inner garment |
| L4 | Outer Garment / Main Attire | Ancient-style ceremonial dress / formal wear / casual wear etc. |
| L5 | Accessories | Headpieces / earrings / necklaces / waist ornaments / hand jewelry |

> **Scope Boundary**: Character derivative assets only include L0–L5 layers (clothing/makeup/hair), excluding props (umbrella/sword/fan/book/lantern etc. held in hands), scene environment (indoor/outdoor/weather etc.), and pose actions (walking/looking back/reaching up etc.). These belong to other asset types.

---

## III. Makeup Constraints (L1)

### Base Model to Derivative Makeup Strategy (Critical)

> Although the character base model is bare-faced, derivative assets default to entering the makeup process. The system should analyze makeup requirements based on user-provided clues and decide intensity between basic makeup, light makeup, and formal makeup, rather than remaining bare-faced.

### L1 Clue Analysis and Makeup Decision

| Step | Processing Content | Decision Result |
|---|---|---|
| S1 | Extract user clues: facial state words, emotion words, intensity words | Form makeup requirement summary |
| S2 | Filter non-makeup clues: props/scenes/actions/poses do not inform makeup decisions | Prevent misjudgment |
| S3 | Match makeup style matrix and assign intensity tier | Basic / Light / Formal |
| S4 | Generate final L1 prompt | Output conclusion only, no analysis process |

### Clue-to-Makeup Mapping (Execution Standard)

| Clue Type | Typical Clues | L1 Decision |
|---|---|---|
| No obvious facial emphasis clues | Only clothing/hairstyle changes, no emotion or state emphasized | Basic makeup |
| Slight facial clues | Gentle, smiling, eyelashes lightly trembling, slight complexion improvement | Light makeup (extremely faint) |
| Clear daily clues | Daily life, going out, leisure | Basic makeup (natural and clear) |
| Clear formal ceremony clues | Wedding, ceremony, important occasion | Formal makeup (exquisite and luxurious) |

> Judgment Principle: All derivative assets must have makeup; first analyze facial clues to determine intensity and style; props, scenes, and pose changes alone do not increase makeup intensity.

### Female Makeup Style Matrix

| Style | Applicable Scene | Core Prompt Keywords |
|---|---|---|
| Elegant Light Makeup | Daily life, first meeting, private chambers | elegant light makeup, faint brows, pure face |
| Palace Noble Makeup | Palace, formal events, power scenes | exquisite makeup, sharp eyebrows, rosy lips |
| Romantic Peach Blossom Makeup | Dating, heart-fluttering, sweet moments | peach blossom makeup, slightly reddened eye corners, glossy lips |
| Wedding Grand Makeup | Wedding ceremony | rich luxurious makeup, crimson lips and phoenix eyes |
| Festival Celebration | Festivals, gatherings | bright colors, pastel makeup |

### Universal Base Skin (Shared by All Makeup)

| Item | Constraint | Prompt Keywords |
|---|---|---|
| Texture | PBR material rendering, naturally luminous | PBR material, natural sheen, soft texture |
| Whiteness | Pink-white base, translucent not pale | pink-white base, fair and luminous |
| Inner Translucency | Soft glow from within | inner translucency, skin glowing from within |
| Forbidden | Matte / dead white / waxy / oily / overexposed | — |

### Basic Makeup Details (Default Tier)

| Item | Constraint | Prompt Keywords |
|---|---|---|
| Eyebrows | Light trim following base model brow shape, no shape change | natural trimmed brows, clean brow shape |
| Eyes | Extremely faint eye makeup, emphasizing clarity and liveliness | clear eyes, extremely faint eyeshadow |
| Cheeks | Extremely faint complexion brightening, pastel blush | natural cheek color, pastel blush |
| Lips | Light pink or mild crimson, restrained | natural lip color, light pink lips |
| Overall | Makeup visible but very subtle | basic makeup, natural makeup feel, soft texture |

### Male Makeup

| Item | Constraint | Prompt Keywords |
|---|---|---|
| Base Skin | PBR material rendering, fair and luminous, fresh and natural | PBR material, fair and luminous, natural sheen |
| Principle | Fake bare face—looks makeup-free but skin is excellent | fake bare face, naturally good skin |
| Eyebrows | Naturally thick brows, no drawn eyebrows | sword brows natural, heroic brow shape |
| Lip Color | Natural blood color, slightly glossy | natural lip color, healthy lip color |

---

## IV. Hairstyle Constraints (L2)

### Female Hairstyle Types

| Style | Description | Applicable | Prompt Keywords |
|---|---|---|---|
| High Bun with Cloud Hair | High updo + hair accessories | Palace, formal | high bun cloud hair, exquisite updo |
| Double Ring Buns | Symmetrical double rings, youthful | Young characters | double ring buns, maiden style |
|堕马髻 (Duo Ma Bun) | Side-low bun, languid | Daily life, leisure | drooping side bun, languid style |
| Loose Hair | Full long hair loose, natural | Private chambers, intimate | cascading long hair, naturally falling |
| High Ponytail | High tied, practical | Martial arts, action | high ponytail, neat and sharp |
| Half-Up Hairstyle | Top half tied + back hair flowing | Daily life, traveling | half-up cloud bun, naturally flowing hair |

### Female Hair Accessories

| Item | Constraint | Prompt Keywords |
|---|---|---|
| Style | Luxurious and exquisite, matching attire | luxurious hair accessories, exquisite craftsmanship |
| Material | Gold/silver + pearls/jade + tassels | gold and silver hairpins, pearl-adorned head |
| Craftsmanship | High-precision modeling, clear details | high-precision craft, fine carving |

### Male Hairstyle Types

| Style | Applicable | Prompt Keywords |
|---|---|---|
| Tied Hair with Half Crown | Daily life, scholars | tied hair half crown, jade pin holding hair |
| Full Crown High Tie | Formal, court | full crown high tie, jade crown holding hair |
| Loose Hair on Shoulders | Intimate, injured | loose hair on shoulders, long hair dark as ink |
| High Ponytail for Battle | Combat, martial arts | high tied battle hair, neat ponytail |

---

## V. Clothing Constraints (L3+L4)

### Female Clothing Matrix

| Style | Garment Type | Applicable | Prompt Keywords |
|---|---|---|---|
| Ancient Long Dress | Long dress, flowing | Daily life, private chambers | ancient long dress, flowing gown |
| Palace Ceremonial Dress | Formal dress, luxurious | Palace, formal events | palace ceremonial dress, luxurious gown |
| Light Casual Wear | Short top, practical | Action, martial arts | light casual wear, short tunic |
| Sleepwear | Thin gauze inner garment, plain colors | Indoor, nighttime | sleepwear, loose and comfortable |
| Wedding Dress | Phoenix crown and robe, layered red attire | Wedding | phoenix crown and robes, layered red garments |

### Female Clothing General Constraints

| Item | Constraint | Prompt Keywords |
|---|---|---|
| Main Color | Traditional Chinese tones as default | traditional Chinese tone clothing, exquisite garments |
| Material | Silk + embroidery + pearlescent fabric | silk texture, embroidery details |
| Texture | Textures must be ultra clear | clear garment texture, ultra-clear textures |
| Shoulders | Shawl / cloud shoulder / decorations | magnificent cloud shoulder, shoulder decorations |
| Layers | Multi-layered wearing, distinct layers | multi-layered dressing, distinct layers |

### Male Clothing Matrix

| Style | Applicable | Prompt Keywords |
|---|---|---|
| Scholar Attire | Daily life, study | scholar attire, long robe |
| Warrior Combat Wear | Combat, martial training | warrior combat wear, battle robe |
| Court Dress | Court, ceremonies | court dress, formal ceremonial robe |
| Casual Wear | Leisure, private | casual wear, simple style |
| Formal Attire | Formal events, celebrations | formal attire, luxurious and exquisite |

---

## VI. Accessory Constraints (L5)

### Female Accessories

| Type | Constraint | Prompt Keywords |
|---|---|---|
| Headpieces | Luxurious and exquisite, not plain | luxurious headpieces, pearl-adorned head |
| Earrings | Dangling tassels / jade drops | tassel earrings, jade drop earrings |
| Necklaces | Yingluo / neck rings | magnificent yingluo, exquisite necklace |
| Waist Ornaments | Palace sash / jade pendant | flowing palace sash, jade pendant at waist |
| Hand Jewelry | Jade bracelets / arm cuffs | translucent jade bracelet, exquisite arm cuff |

### Male Accessories

| Type | Constraint | Prompt Keywords |
|---|---|---|
| Hair Crown | Jade crown / gold crown, exquisite | jade crown holding hair |
| Waist Band | Wide waist band / leather belt | wide waist band, distinct texture |
| Jade Pendant | Translucent and warm | jade pendant at waist |
| Weapon | Sword / fan / flute (optional) | long sword at side, folding fan half-hidden |

---

## VII. Clothing-Makeup Combination Quick Reference

| Scene | Makeup | Hairstyle | Clothing | Accessories |
|---|---|---|---|---|
| Private daily life | Elegant light makeup | Loose hair / half-up | Ancient long dress | Moderate |
| First encounter | Elegant light makeup | Half-up / drooping bun | Ancient long dress | Moderately high |
| Romantic interaction | Romantic peach blossom | Half-up / drooping bun | Long dress / light wear | Moderate |
| Formal debut | Palace noble makeup | High bun cloud hair | Palace ceremonial dress | Very elaborate |
| Night intimate | Light / peach blossom | Loose hair / drooping bun | Sleepwear | Minimalist |
| Wedding ceremony | Wedding grand makeup | High bun cloud hair | Wedding dress | Very elaborate |
| Martial action | Bare-faced (extremely faint) | Tied ponytail | Light casual wear | Simple |

---

> **🔍 Uncovered Scene Inference Rules**
>
> When the user-described scene/situation is not in the table above, infer based on this style's core genes:
>
> | Inference Dimension | Chinese-Style 3D Rendering Gene |
> |---|---|
> | Makeup Intensity | Default elegant light makeup; palace/power/formal → palace noble makeup; heart-fluttering/sweet → romantic peach blossom; wedding/ceremony → wedding grand makeup; festival gatherings → festival celebration makeup |
> | Hairstyle | Daily/private chambers → half-up or drooping bun; palace/formal → high bun cloud hair; intimate/night → loose hair; martial/action → tied ponytail |
> | Clothing | Ancient-style as baseline; emotional scenes → flowing long dress; power/formal → palace ceremonial dress; action → light casual wear; PBR material always maintained |
> | Accessory Complexity | Daily → moderate; formal/palace → very elaborate (gold/silver hairpieces + yingluo + jade pendants); intimate → minimalist; action → simple |
> | Quality Baseline | PBR material + cinematic lighting always locked; volume and sheen prioritized over flat decoration |

## VIII. Four-View Character Sheet Specifications

> Derivative clothing/makeup overlays must still output four-view character sheets to ensure consistency of makeup and attire across all angles.

### View Definitions

| Position | View | Angle | Shot Size | Requirements | Prompt Keywords |
|---|---|---|---|---|---|
| Far Left | Portrait Closeup | Frontal eye-level | Face to collarbone | Face occupies 60%+, features/makeup clearly visible | portrait closeup, face detail, makeup detail |
| Left Center | Front View | Front 0° | Full body standing pose | Facing camera, full front view of clothing | front view, height mark |
| Right Center | Side View | Right profile 90° | Full body standing pose | Clean side profile, clothing side layers | side view, profile, height mark |
| Far Right | Back View | Rear 180° | Full body standing pose | Back of head with hair accessories / back clothing / hair ends clearly visible | back view, rear view, height mark |

### Frame Specifications

| Item | Constraint |
|---|---|
| Layout | Four views arranged left-to-right in a single frame |
| Background | Plain solid gray #B8B8B8 |
| Stance | Natural standing, feet parallel and slightly apart, arms naturally hanging or slightly extended (**no pose changes allowed**) |
| Expression | Micro-expression matching makeup style (e.g., elegant light makeup → serene; peach blossom makeup → slight smile), limited to facial micro-expressions only, no body movements |
| Lighting | Even soft light, front key light + dual side fill lights, no hard shadows |
| Consistency | Face/makeup/hairstyle/hair accessories/clothing/accessories must be identical across all four views |
| Aspect Ratio | Recommended 4:1 or 3:1 |

---

## IX. Prompt Template

### Output Format Constraints

| Item | Constraint |
|---|---|
| Output Content | **Only output prompt text**, no other content |
| Forbidden Output | Quick reference tables, layered build plans, visual constraint tables, forbidden items tables, derivative plans, output suggestions, core element tables, and all non-prompt content |
| No Scenes | Character derivative assets **do not include scene/environment descriptions**; no scene/environment/weather/background narrative content (scenes belong to scene assets) |
| No Props | **No prop interactions**; no umbrella/sword/fan/book/lantern/goblet or other held/interactive items (props belong to prop assets) |
| No Pose Changes | **Do not change base model pose**; no walking/looking back/reaching/turning/running or any action/posture changes; maintain natural standing |
| Format | Directly output usable prompt code block, no title, table, explanation, plan comparison |

### Complete Clothing-Makeup Overlay (Four Views)

Using character base image as base, img2img overlay clothing/makeup/hair,
3D rendering style, high-precision modeling, PBR materials, Chinese-style 3D, cinematic lighting,
Ancient-style {gender} character four-view character sheet, 3D rendered, high-precision modeling, 8K, ultra-faithful,
character design sheet, character turnaround,
Maintain base model facial features unchanged, {overall temperament}, face clean and free of markings or stains, no facial markings, no stains, no blood,
【L1·Makeup】Decision based on user clues: {basic makeup / light makeup / formal makeup}; using {makeup style}, PBR material rendering, {eyebrow makeup}, {eye makeup}, {lip makeup},
【L2·Hairstyle】{hairstyle type}, high-precision hair strands clear, {hair accessories description},
【L3+L4·Clothing】{main color}{garment style}, {material}, {decorative craft}, clear garment texture, PBR material rendering,
【L5·Accessories】{headpieces}, {earrings}, {necklaces}, {waist ornaments},
Four views arranged left-to-right in one frame: portrait closeup + front view + side view + back view,
Natural standing stance, plain gray solid background, even soft lighting, no hard shadows,
Four-view consistency, clear Chinese-style 3D modeling, high-precision modeling clarity,
No text in the image

---

## X. Constraint Rules

### Mandatory Rules

| ID | Rule |
|---|---|
| R1 | Face must remain identical to base model after overlay |
| R2 | Clothing must use "clear garment texture + PBR material rendering" |
| R3 | Female accessories must be "luxurious and exquisite + fine craftsmanship" |
| R4 | Makeup/hairstyle/clothing/accessories style must be unified |
| R5 | Must output four-view character sheet (portrait closeup + front view + side view + back view) |
| R6 | Must specify "plain gray solid background" |
| R7 | Must specify "four-view consistency" |
| R8 | **Output only prompt** — no quick reference tables / layered plans / visual constraints / forbidden items / derivative plans / output suggestions or any non-prompt content |
| R9 | **No scene descriptions** — character derivative assets do not include scenes/environments/weather/background narrative; scenes are independent asset types |
| R10 | **No prop interactions** — no held/interactive items (umbrella/sword/fan/book etc.); props are independent asset types |
| R11 | **Pose unchanged** — must maintain base model natural standing pose; no actions/postures/poses changes allowed |
| R12 | **L1: Analyze first, then decide** — parse user facial clues first, then determine basic/light/formal makeup |
| R13 | **All derivative assets need makeup** — normally do not remain bare-faced; at minimum use basic makeup |
| R14 | **Makeup intensity controlled** — even with makeup, must be restrained; no modern heavy makeup / exaggerated color cosmetics |
| R15 | **Props/scenes/actions do not drive intensity upgrade** — props alone, environments, or actions alone do not elevate basic makeup to stronger tiers |

### Forbidden Rules

| ID | Forbidden |
|---|---|
| X1 | Facial deviation after overlay |
| X2 | Accessories too plain / modern (female) |
| X3 | Conflicting makeup/clothing styles |
| X4 | Complex scene backgrounds (must be solid color) |
| X5 | Inconsistent clothing/makeup across four views |
| X6 | Outputting anything other than prompt text (tables/plans/suggestions/explanations/variations etc.) |
| X7 | Adding scene descriptions to character derivative assets (street scenes / rain scenes / indoors / streets / weather etc. environmental elements) |
| X8 | Outputting sections like "Core Element Quick Reference", "Layered Build Plan", "Visual Constraints", "Forbidden Items", "Derivative Plans" |
| X9 | Adding any prop interactions (holding umbrella/sword/fan/book/lantern/goblet etc.) |
| X10 | Changing base model pose (walking/looking back/reaching/turning/running/bowing head/looking up etc. action descriptions) |
| X11 | Adding expression-pose联动 descriptions (e.g., "turning 45° walking with slight smile" narrative descriptions) |
| X12 | Applying fixed makeup without analyzing user clues first |
| X13 | Incorrectly remaining bare-faced, causing derivative assets to lack应有的 makeup |
| X14 | Mistakenly upgrading makeup intensity based solely on props/scenes/action words, leading to incorrect makeup intensity decisions |
