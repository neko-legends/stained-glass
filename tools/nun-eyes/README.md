# Eye repair for the praying girl model

The generated model had thick, protruding eyelash slabs with a smeared brown texture. `fix.py` edits
the GLB directly:

1. finds each lash slab on the face (brownish vertices near the expected spot);
2. flattens the vertices in an ellipse around it onto a smooth surface fitted through the surrounding
   skin (thin-plate spline), 0.6 mm proud of it;
3. repaints every texel of the affected triangles: smooth skin interpolated from the surroundings,
   then a thin closed-eye lash line with two short lashes at the outer corner, following the reference;
4. flattens the normal map over the same texels and recomputes the moved vertices' normals.

```bash
python tools/nun-eyes/fix.py tools/nun-eyes model/nunHQ.glb public/models/girl.glb
```

Needs Python with numpy, scipy and Pillow. The first argument is the folder holding `glb.py` and
`rast.py`; it also receives two preview images (`fixed_front.png`, `fixed_left.png`).
