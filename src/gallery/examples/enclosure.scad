// Enclosure
// An open electronics case with four screw standoffs for a PCB.

/* [PCB] */
// PCB width (mm)
pcb_width = 70; // [20:1:200]
// PCB depth (mm)
pcb_depth = 50; // [20:1:200]
// Space between the PCB and the walls (mm)
pcb_gap = 2; // [0.5:0.5:10]
// Height of the standoffs under the PCB (mm)
standoff_height = 5; // [2:0.5:20]

/* [Case] */
// Inside height above the floor (mm)
inner_height = 25; // [10:1:100]
// Wall thickness (mm)
wall = 2; // [1.2:0.2:5]
// Floor thickness (mm)
floor_thickness = 2; // [1:0.2:5]

/* [Screws] */
// Standoff outer diameter (mm)
boss_diameter = 6; // [4:0.5:12]
// Screw pilot hole diameter (mm)
screw_hole = 2.5; // [1.5:0.1:4]

/* [Hidden] */
hole_inset = 3.5;
$fn = 40;
inner_width = pcb_width + 2 * pcb_gap;
inner_depth = pcb_depth + 2 * pcb_gap;

module shell() {
  difference() {
    cube([inner_width + 2 * wall, inner_depth + 2 * wall, floor_thickness + inner_height]);
    translate([wall, wall, floor_thickness])
      cube([inner_width, inner_depth, inner_height + 1]);
  }
}

module standoff() {
  difference() {
    cylinder(h = standoff_height, d = boss_diameter);
    translate([0, 0, -1]) cylinder(h = standoff_height + 2, d = screw_hole);
  }
}

module standoffs() {
  for (x = [hole_inset, pcb_width - hole_inset], y = [hole_inset, pcb_depth - hole_inset])
    translate([wall + pcb_gap + x, wall + pcb_gap + y, floor_thickness - 0.01])
      standoff();
}

shell();
standoffs();
