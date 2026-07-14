import Svg, { Circle, Path } from "react-native-svg";

// Road-shaped maneuver glyphs. Ionicons has generic arrows and reload icons,
// but no directional roundabout family; these keep turn and roundabout exits
// visually consistent and make the instructed exit explicit.
export default function ManeuverIcon({ maneuver, color, size = 32 }) {
  if (!maneuver) return null;
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      accessible={false}
      pointerEvents="none"
    >
      {maneuver.type === "crossing" ? (
        <CrossingGlyph color={color} />
      ) : maneuver.type === "roundabout" ? (
        <RoundaboutGlyph direction={maneuver.direction} color={color} />
      ) : (
        <TurnGlyph direction={maneuver.direction} color={color} />
      )}
    </Svg>
  );
}

function CrossingGlyph({ color }) {
  return (
    <>
      <StrokePath color={color} d="M7 3V29" />
      <StrokePath color={color} d="M25 3V29" />
      <StrokePath color={color} d="M4 16H28" />
      <StrokePath color={color} d="M23 11L28 16L23 21" />
    </>
  );
}

function StrokePath({ d, color }) {
  return (
    <Path
      d={d}
      fill="none"
      stroke={color}
      strokeWidth={2.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
}

function TurnGlyph({ direction, color }) {
  const left = direction === "left";
  return (
    <>
      <StrokePath
        color={color}
        d={left ? "M19 29V18C19 11.5 15.5 8 9 8H4" : "M13 29V18C13 11.5 16.5 8 23 8H28"}
      />
      <StrokePath
        color={color}
        d={left ? "M8 4L4 8L8 12" : "M24 4L28 8L24 12"}
      />
    </>
  );
}

function RoundaboutGlyph({ direction, color }) {
  const exit = {
    straight: {
      road: "M16 8V2",
      arrow: "M12 6L16 2L20 6",
    },
    right: {
      road: "M24 16H30",
      arrow: "M26 12L30 16L26 20",
    },
    left: {
      road: "M8 16H2",
      arrow: "M6 12L2 16L6 20",
    },
    "u-turn": {
      road: "M10.5 21.5V30",
      arrow: "M6.5 26L10.5 30L14.5 26",
    },
  }[direction] || {
    road: "M16 8V2",
    arrow: "M12 6L16 2L20 6",
  };
  return (
    <>
      <Circle
        cx={16}
        cy={16}
        r={8}
        fill="none"
        stroke={color}
        strokeWidth={2.8}
      />
      <StrokePath color={color} d="M16 30V24" />
      <StrokePath color={color} d={exit.road} />
      <StrokePath color={color} d={exit.arrow} />
    </>
  );
}
