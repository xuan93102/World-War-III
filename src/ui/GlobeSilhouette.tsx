/**
 * A globe, very faintly, behind the menus.
 *
 * It used to be Taiwan, which was true of the only map that exists but said
 * the wrong thing about where the game is going. A wireframe globe promises
 * the world without claiming geography the game does not have yet — no
 * coastlines are drawn, so none of them can be wrong.
 *
 * The lines are not decoration arranged to look spherical. A meridian seen
 * orthographically is an ellipse whose half-width is R·|sin λ|: edge-on and
 * flat at the meridian facing you, the full circle at ninety degrees round.
 * Animating that width *is* rotation, which is why the thing reads as turning
 * rather than as pulsing.
 */

/** The radius everything is drawn at; the viewBox is sized to match. */
const R = 100;

/** Latitudes to ring, in degrees. Poles are where the limb already is. */
const PARALLELS = [-60, -30, 0, 30, 60];

/** How much a parallel is squashed by looking at the globe from its equator. */
const TILT = 0.26;

const MERIDIANS = 6;
/** One full turn. Slow: this is a background, not a spinner. */
const SPIN_SECONDS = 48;

const radians = (degrees: number) => (degrees * Math.PI) / 180;

export function GlobeSilhouette() {
  return (
    <svg
      className="globe-silhouette"
      viewBox={`${-R - 10} ${-R - 10} ${(R + 10) * 2} ${(R + 10) * 2}`}
      aria-hidden="true"
      focusable="false"
    >
      <circle className="globe-limb" cx={0} cy={0} r={R} />
      {PARALLELS.map((latitude) => {
        const c = Math.cos(radians(latitude));
        return (
          <ellipse
            key={latitude}
            className="globe-parallel"
            cx={0}
            cy={-R * Math.sin(radians(latitude))}
            rx={R * c}
            ry={R * c * TILT}
          />
        );
      })}
      {Array.from({ length: MERIDIANS }, (_, i) => (
        <ellipse
          key={i}
          className="globe-meridian"
          cx={0}
          cy={0}
          rx={0}
          ry={R}
          // Negative delays start each meridian partway through the turn, so
          // they are spread around the globe instead of all edge-on at once.
          //
          // Half the period, not the whole one: a meridian goes edge-on twice
          // per rotation — at λ and at λ+180, which project identically — so
          // spreading over the full turn would pair them up and waste half.
          style={{ animationDelay: `${-(i * SPIN_SECONDS) / (2 * MERIDIANS)}s` }}
        />
      ))}
    </svg>
  );
}
