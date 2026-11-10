# Face repair for the praying girl model

The generated model (`model/nunHQ.glb`) had thick, protruding eyelash slabs with a smeared brown
texture. `face.py` edits the GLB directly so the face matches the close-up reference
(`references/girlface.webp`):

1. finds each lash slab (brownish vertices near the expected spot) and flattens the vertices in an
   ellipse around it onto a smooth surface fitted through the surrounding skin (thin-plate spline);
2. projects a front view of the reference face (`girlface-front.webp`, drawn from the close-up by an
   image model: same eyes, lashes, lips and blush, seen straight on with flat light) onto the face
   skin. It is registered on both eyes and the mouth, colour-matched to the model's skin, limited to
   the heart of the face (brows to just under the lips) and feathered at the edge, so the model's own
   chin, jaw, ears and hair are untouched;
3. flattens the normal map over the eyes and recomputes the moved vertices' normals.

```bash
python tools/nun-eyes/face.py tools/nun-eyes model/nunHQ.glb tools/nun-eyes/girlface-front.webp public/models/girl.glb
```

Needs Python with numpy, scipy and Pillow. The first argument is the folder holding `glb.py` and
`rast.py`; it also receives preview images (`face_front.png`, `face_left.png`, `face_mask.png`).

`fix.py` is the earlier, simpler version: it only flattens the slabs and paints a plain lash line.
