// Print-in-place hinge
// Two leaves joined by alternating knuckles around a captive pin. Prints flat, no supports.

/* [Hinge] */
// Hinge length along the pin (mm)
hinge_length = 40; // [15:1:150]
// Length of each leaf (mm)
leaf_length = 20; // [8:1:80]
// Number of knuckles (odd)
knuckles = 5; // [3:2:11]

/* [Fit] */
// Pin diameter (mm)
pin_diameter = 3; // [2:0.5:8]
// Gap between moving parts (mm)
clearance = 0.4; // [0.2:0.05:0.8]

/* [Hidden] */
knuckle_wall = 1.6;
leaf_thickness = 2.4;
$fn = 48;

knuckle_d = pin_diameter + 2 * (clearance + knuckle_wall);
axis_z = knuckle_d / 2;
segment = hinge_length / knuckles;

module along_axis(x0, len, d) {
  translate([x0, 0, axis_z]) rotate([0, 90, 0]) cylinder(h = len, d = d);
}

// owner 0 is the leaf at negative Y and carries the pin; owner 1 is the leaf at positive Y.
module leaf(owner) {
  difference() {
    translate([0, owner == 0 ? -leaf_length : 0, 0])
      cube([hinge_length, leaf_length, leaf_thickness]);
    for (i = [0:knuckles - 1])
      if (i % 2 != owner)
        along_axis(i * segment - clearance, segment + 2 * clearance, knuckle_d + 2 * clearance);
  }
}

module knuckles_of(owner) {
  for (i = [0:knuckles - 1])
    if (i % 2 == owner)
      along_axis(i * segment + clearance / 2, segment - clearance, knuckle_d);
}

module side_a() {
  leaf(0);
  knuckles_of(0);
  along_axis(clearance / 2, hinge_length - clearance, pin_diameter);
}

module side_b() {
  difference() {
    union() {
      leaf(1);
      knuckles_of(1);
    }
    along_axis(-1, hinge_length + 2, pin_diameter + 2 * clearance);
  }
}

side_a();
side_b();
