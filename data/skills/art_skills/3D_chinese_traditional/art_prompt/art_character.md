---
name: art_character
description: Character Base Image Generation · Constraint Manual
metaData: art_skills
---

# Character Base Image Generation · Constraint Manual

---

## I. Foundational Principles

1. **Design is Soul** — Character design is the core anchor, Chinese-style 3D design with smooth lines
2. **Base Model is Foundation** — Basic undergarments + bare face; subsequent clothing and makeup are overlay layers
3. **Four-View Consistency** — Face/body/hair/base clothing must be highly consistent across all views
4. **Classical Elegance** — Bare face must still convey character temperament (elegant/graceful/heroic)

---

## II. Facial Features Constraints

> Do not fix facial feature parameters; let the character description (gender/age/personality/temperament) drive AI to freely generate facial features, ensuring visual differentiation between characters.

### General Requirements

| Item | Constraint |
|---|---|
| Facial Features | Derived naturally from character description; no preset face shape/eye shape/brow shape/nose shape/lip shape |
| Style Foundation | Chinese-style 3D rendering, high-precision modeling, PBR materials, cinematic lighting |
| Temperament | Must extract overall temperament keywords from character description (e.g., elegant grace/refined heroism/martial romance) and include in prompt |
| Expression | Neutral micro-expression matching character temperament |

---

## III. Skin Texture Constraints

### Female

| Item | Constraint | Prompt Keywords |
|---|---|---|
| Skin Tone | Pink-white base, even across body, fair and luminous | pink-white base, fair and luminous, 3D modeled skin |
| Sheen | PBR material rendering, natural sheen, non-matte | PBR material rendering, natural sheen, soft texture |
| Texture | High-precision modeling, clear textures, soft edges | high-precision modeling, clear textures, soft edges |
| Exposed Skin | Face/neck/hands | delicate hands, graceful neck lines |

### Male

| Item | Constraint | Prompt Keywords |
|---|---|---|
| Skin Tone | Fair base, even across body, healthy texture | fair base, healthy texture, 3D modeled skin |
| Sheen | PBR material rendering, natural sheen | PBR material rendering, natural sheen, soft texture |
| Texture | High-precision modeling, clean and sharp | high-precision modeling, 3D rendered, soft finish |

---

## IV. Body Proportion Constraints

### Female

| Item | Constraint | Prompt Keywords |
|---|---|---|
| Height | Specified by character setting, default range 160-170cm | {height}cm tall, {height description e.g., tall elegant woman} |
| Head-to-Body Ratio | 7 to 7.5 heads tall, classical proportions | 7 heads tall proportion, classical proportions |
| Shoulders/Neck | Swan neck, graceful shoulder-neck line | swan neck, graceful shoulders and neck |
| Hands | Slender fair hands, natural fingers | slender fair hands, natural fingers |
| Posture | Classical temperament, elegant and upright | elegant posture, upright bearing |

### Male

| Item | Constraint | Prompt Keywords |
|---|---|---|
| Height | Specified by character setting, default range 175-185cm | {height}cm tall, {height description e.g., tall imposing man} |
| Head-to-Body Ratio | 7 to 7.5 heads tall, classical proportions | 7 heads tall proportion, classical proportions |
| Shoulders/Neck | Broad shoulders, strong neck | broad shoulders, strong neck |
| Hands | Defined knuckles, natural fingers | defined knuckles, natural fingers |
| Posture | Refined heroism, upright and dignified | heroic posture, upright bearing |

---

## V. Basic Hairstyle Constraints

> Only define natural hairstyles; hair accessories are added in the clothing/accessories overlay stage.

### Female

| Item | Constraint | Prompt Keywords |
|---|---|---|
| Hair Color | Ink black, no other colors allowed | ink black long hair, dark as silk |
| Hair Length | Long hair reaching waist | long hair to waist, long hair |
| Hair Texture | High-precision modeling, clear individual strands | high-precision modeling, clear hair strands |
| Style | Naturally loose, no hair accessories | long hair naturally cascading, no hair accessories |

### Male

| Item | Constraint | Prompt Keywords |
|---|---|---|
| Hair Color | Ink black, no other colors allowed | ink black long hair, dark as ink |
| Hair Length | Long hair to shoulders or tied up | long hair to shoulders, tied hair |
| Hair Texture | High-precision modeling, clear individual strands | high-precision modeling, clear hair strands |
| Style | Naturally loose or half-tied, no hair crown | long hair naturally cascading, half-tied long hair |

---

## VI. Basic Clothing Constraints

> No special constraints on basic clothing; female wears plain ancient-style long dress, male wears plain ancient-style long robe. Formal attire is added in the clothing/accessories overlay stage.

### Female Basic Clothing

Plain ancient-style long dress, base colors only, no patterned decorations.

### Male Basic Clothing

Plain ancient-style long robe, base colors only, no patterned decorations.

### Dressing Consistency Rules

- Clothing style must be consistent to ensure no color interference in subsequent overlays
- Covers all areas except face/hands/neck
- Base clothing款式 must be identical across all four views
- Basic clothing serves as a safe underlayer; focus is on face and posture

---

## VII. Four-View Character Sheet Specifications

### View Definitions

| Position | View | Angle | Shot Size | Requirements | Prompt Keywords |
|---|---|---|---|---|---|
| Far Left | Portrait Closeup | Frontal eye-level | Crown of head to collarbone | Complete from crown to collarbone, face occupies 60%+, features clearly visible | portrait closeup, face detail |
| Left Center | Front View | Front 0° | Full body standing pose | Facing camera, arms natural, complete from crown to toe | front view, full body |
| Right Center | Side View | Right profile 90° | Full body standing pose | Clean side profile outline, complete from crown to toe | side view, profile, full body |
| Far Right | Back View | Rear 180° | Full body standing pose | Back of head/back/hair ends/feet clearly visible, complete from crown to toe | back view, rear view, full body |

### Frame Specifications

| Item | Constraint |
|---|---|
| Layout | Four views arranged left-to-right in a single frame |
| Background | Plain solid gray #B8B8B8 |
| Stance | Natural standing, feet parallel and slightly apart, arms naturally hanging |
| Full Body | Standing poses must show complete crown to toe, no cropping allowed |
| Closeup | Portrait closeup must show complete crown to collarbone, no cropping allowed |
| Expression | Neutral micro-expression matching character temperament |
| Lighting | Even soft light, front key light + dual side fill lights, no hard shadows |
| Consistency | Skin tone/body/hair/face/base clothing must be identical across all four views |
| Aspect Ratio | Recommended 4:1 or 3:1 |

---

## VIII. Prompt Template

{gender} character four-view character sheet, 3D rendering style, high-precision modeling, PBR materials, Chinese-style 3D, cinematic lighting,
character design sheet, character turnaround,
{facial features derived from character description}, {overall temperament}, bare face, no facial markings, no stains, no blood,
{skin tone}, PBR material rendering, 3D rendered translucent texture, high-precision modeling, rich light and shadow layers,
{height description, e.g., 165cm tall, tall elegant woman}, {head-to-body ratio, e.g., 7 heads tall proportion}, {body description}, {posture description},
{hair color}{hair length}, high-precision hair strands clear, {basic hairstyle}, no hair accessories,
(female: plain ancient-style long dress / male: plain ancient-style long robe), base colors, no patterned decorations,
Four views arranged left-to-right in one frame: portrait closeup + front view + side view + back view,
Portrait closeup complete from crown to collarbone, no cropping of crown, head to collarbone complete,
Full standing pose complete from crown to toe, full body head to toe, no cropping of crown or toe,
Natural standing stance, plain gray solid background, even soft lighting, no hard shadows,
Four-view consistency, clear Chinese-style 3D modeling, high-precision modeling clarity,
No text in the image

---

## IX. Constraint Rules

### Mandatory Rules

| ID | Rule |
|---|---|
| R1 | Must be bare face (no makeup) |
| R2 | Must specify basic clothing (female: plain ancient-style long dress; male: plain ancient-style long robe) |
| R3 | Must state "no hair accessories, no jewelry" |
| R4 | Must specify "plain gray solid background" |
| R5 | Must specify "four-view consistency" |
| R6 | Full standing pose must show complete crown to toe, no cropping |
| R7 | Must declare character height and constrain full-body proportions via head-to-body ratio (female default 160-170cm/7-heads, male default 175-185cm/7-heads) |
| R8 | Portrait closeup must show complete crown to collarbone, no cropping of crown |

### Forbidden Rules

| ID | Forbidden |
|---|---|
| X1 | Any clothing/accessories/makeup beyond basic layer |
| X2 | Direct overhead hard light / under-light / cool colored light |
| X3 | Overly whitened lifeless skin / grayish complexion |
| X4 | Complex scene backgrounds (must be solid color) |
| X5 | Exaggerated expressions / dynamic poses |
| X6 | Full standing pose cropped at crown or toes, must show complete head to toe |
| X7 | Portrait closeup cropped at crown, must show complete crown to collarbone |
| X8 | Ignoring height and head-to-body ratio constraints; height must be explicitly declared and full-body proportions reflected via head-to-body ratio |
