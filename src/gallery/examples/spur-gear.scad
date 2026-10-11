// Spur gear
// An involute spur gear with a round bore.

/* [Gear] */
// Number of teeth
teeth = 20; // [8:1:80]
// Gear module: pitch diameter divided by teeth (mm)
gear_module = 1; // [0.5:0.25:4]
// Pressure angle (degrees)
pressure_angle = 20; // [14.5, 20, 25]
// Thickness (mm)
thickness = 6; // [2:0.5:30]

/* [Fit] */
// Bore diameter (mm)
bore = 5; // [0:0.5:30]
// Backlash per tooth (mm)
backlash = 0.1; // [0:0.05:0.5]

/* [Hidden] */
steps = 8;
$fn = 64;

pitch_r = teeth * gear_module / 2;
base_r = pitch_r * cos(pressure_angle);
outer_r = pitch_r + gear_module;
root_r = pitch_r - 1.25 * gear_module;
start_r = max(base_r, root_r);
half_tooth = ((PI * gear_module / 2 - backlash) / 2) / pitch_r * 180 / PI;

// Involute function, angle in degrees, result in radians.
function inv(a) = tan(a) - a * PI / 180;
// Half-width angle of the tooth (degrees) at radius r.
function flank(r) = max(half_tooth + (inv(pressure_angle) - inv(acos(min(1, base_r / r)))) * 180 / PI, 0.2);
function polar(r, a) = [r * cos(a), r * sin(a)];

module tooth() {
  rise = [for (i = [0:steps]) start_r + (outer_r - start_r) * i / steps];
  polygon(concat(
    [[0, 0]],
    [for (r = rise) polar(r, -flank(r))],
    [for (i = [steps:-1:0]) polar(rise[i], flank(rise[i]))]
  ));
}

module gear_2d() {
  difference() {
    union() {
      circle(r = root_r);
      for (i = [0:teeth - 1]) rotate(i * 360 / teeth) tooth();
    }
    if (bore > 0) circle(d = min(bore, 2 * root_r - 2 * gear_module));
  }
}

linear_extrude(height = thickness) gear_2d();
