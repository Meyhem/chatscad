// Cable clip
// Snap-in cable holders on a flat base for an adhesive pad.

/* [Clip] */
// Cable diameter (mm)
cable_diameter = 6; // [2:0.5:15]
// Number of cables
cable_count = 2; // [1:1:6]
// Clip width along the cable (mm)
clip_width = 10; // [5:1:30]
// Base thickness (mm)
base_thickness = 2; // [1:0.2:5]

/* [Hidden] */
wall = 1.6;
opening = 0.75;
$fn = 48;

pitch = cable_diameter + 2 * wall;

module ring() {
  difference() {
    circle(d = cable_diameter + 2 * wall);
    circle(d = cable_diameter);
    translate([-cable_diameter * opening / 2, 0]) square([cable_diameter * opening, cable_diameter]);
  }
}

module clips() {
  for (i = [0:cable_count - 1])
    translate([wall + pitch / 2 + i * pitch, clip_width, base_thickness + cable_diameter / 2])
      rotate([90, 0, 0]) linear_extrude(height = clip_width) ring();
}

module base() {
  cube([cable_count * pitch + 2 * wall, clip_width, base_thickness]);
}

base();
clips();
