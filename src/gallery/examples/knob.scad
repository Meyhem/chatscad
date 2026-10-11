// Knob
// A ridged knob for a D-shaft potentiometer or encoder.

/* [Knob] */
// Outer diameter (mm)
diameter = 30; // [12:1:80]
// Height (mm)
height = 15; // [6:1:40]
// Number of grip ridges
grip_ridges = 24; // [8:1:60]

/* [Shaft] */
// Shaft diameter (mm)
shaft_diameter = 6; // [3:0.1:10]
// Depth of the flat on the D-shaft (mm)
flat_depth = 1.5; // [0:0.1:3]

/* [Hidden] */
clearance = 0.2;
top = 3;
$fn = 64;

module body() {
  ridge = diameter * PI / grip_ridges / 2;
  difference() {
    cylinder(h = height, d = diameter);
    for (i = [0:grip_ridges - 1])
      rotate([0, 0, i * 360 / grip_ridges])
        translate([diameter / 2, 0, -1])
          cylinder(h = height + 2, d = ridge, $fn = 12);
  }
}

module shaft_hole() {
  d = shaft_diameter + clearance;
  translate([0, 0, -1])
    intersection() {
      cylinder(h = height - top + 1, d = d);
      translate([-d, -d, -1])
        cube([2 * d, d + d / 2 - flat_depth, height + 2]);
    }
}

difference() {
  body();
  shaft_hole();
}
