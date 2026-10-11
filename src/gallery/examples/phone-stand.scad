// Phone stand
// A desk stand that holds a phone at a fixed viewing angle.

/* [Stand] */
// Viewing angle from the desk (degrees)
angle = 65; // [45:1:80]
// Phone thickness including the case (mm)
phone_thickness = 12; // [6:0.5:20]
// Stand width (mm)
width = 70; // [30:1:150]
// Front lip height (mm)
lip_height = 12; // [5:1:30]

/* [Hidden] */
t = 4;
rest_length = 90;
$fn = 32;

rest_start = [t + phone_thickness, t];
rest_end = rest_start + rest_length * [cos(angle), sin(angle)];
base_length = rest_end[0] + 20;

module profile() {
  square([base_length, t]);
  square([t, lip_height + t]);
  translate(rest_start) rotate(angle) translate([0, -t]) square([rest_length, t]);
  hull() {
    translate(rest_end) circle(d = t);
    translate([base_length - t / 2, t / 2]) circle(d = t);
  }
}

rotate([90, 0, 0]) translate([0, 0, -width]) linear_extrude(height = width) profile();
