// L bracket
// A right-angle bracket with screw holes in both legs.

/* [Size] */
// Bracket width (mm)
width = 30; // [10:1:100]
// Length of the floor leg (mm)
leg_a = 40; // [15:1:150]
// Height of the wall leg (mm)
leg_b = 30; // [15:1:150]
// Plate thickness (mm)
thickness = 4; // [2:0.5:10]

/* [Holes] */
// Screw size
screw = 3.4; // [3.4:M3, 4.5:M4]
// Holes in each leg
holes_per_leg = 2; // [1:1:4]
// Add stiffening ribs on both sides
gusset = true;

/* [Hidden] */
rib = 3;
$fn = 32;

module plate() {
  cube([leg_a, width, thickness]);
  cube([thickness, width, leg_b]);
}

module holes() {
  for (i = [1:holes_per_leg]) {
    translate([thickness + (leg_a - thickness) * i / (holes_per_leg + 1), width / 2, -1])
      cylinder(h = thickness + 2, d = screw);
    translate([-1, width / 2, thickness + (leg_b - thickness) * i / (holes_per_leg + 1)])
      rotate([0, 90, 0]) cylinder(h = thickness + 2, d = screw);
  }
}

module rib_at(y) {
  size = min(leg_a, leg_b) - thickness;
  translate([thickness - 0.01, y + rib, thickness - 0.01])
    rotate([90, 0, 0])
      linear_extrude(height = rib)
        polygon([[0, 0], [size * 0.6, 0], [0, size * 0.6]]);
}

difference() {
  union() {
    plate();
    if (gusset) {
      rib_at(0);
      rib_at(width - rib);
    }
  }
  holes();
}
