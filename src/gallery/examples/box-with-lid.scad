// Box with lid
// An open box and a lid with an insert lip, printed side by side.

/* [Box] */
// Inside width (mm)
inner_width = 60; // [20:1:200]
// Inside depth (mm)
inner_depth = 40; // [20:1:200]
// Inside height (mm)
inner_height = 30; // [10:1:150]
// Wall thickness (mm)
wall = 2; // [1.2:0.2:5]

/* [Lid] */
// Height of the lip that sits inside the box (mm)
lip_height = 4; // [2:0.5:10]
// Gap between the lip and the box wall (mm)
clearance = 0.2; // [0:0.05:0.6]

/* [Hidden] */
gap = 10;
outer_width = inner_width + 2 * wall;
outer_depth = inner_depth + 2 * wall;

module box() {
  difference() {
    cube([outer_width, outer_depth, inner_height + wall]);
    translate([wall, wall, wall])
      cube([inner_width, inner_depth, inner_height + 1]);
  }
}

module lid() {
  lip_width = inner_width - 2 * clearance;
  lip_depth = inner_depth - 2 * clearance;
  cube([outer_width, outer_depth, wall]);
  translate([wall + clearance, wall + clearance, wall - 0.01])
    difference() {
      cube([lip_width, lip_depth, lip_height]);
      translate([wall, wall, -1])
        cube([lip_width - 2 * wall, lip_depth - 2 * wall, lip_height + 2]);
    }
}

box();
translate([outer_width + gap, 0, 0]) lid();
