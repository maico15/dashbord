import React from 'react';

const LoadingSpinner = ({ size = 80 }) => {
  const cx = size / 2;
  const cy = size * 0.55;
  const outerH = size * 0.87;
  const outerW = size * 0.87;
  const innerH = outerH * 0.6;
  const innerW = outerW * 0.6;

  const outerPts = `${cx},${size*0.1} ${cx+outerW/2},${outerH+size*0.1} ${cx-outerW/2},${outerH+size*0.1}`;
  const innerPts = `${cx},${size*0.3} ${cx+innerW/2},${innerH+size*0.3} ${cx-innerW/2},${innerH+size*0.3}`;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <style>{`
        @keyframes spin-cw  { from { transform: rotate(0deg);   } to { transform: rotate(360deg);  } }
        @keyframes spin-ccw { from { transform: rotate(0deg);   } to { transform: rotate(-360deg); } }
        .outer-pyramid { animation: spin-cw  2.5s linear infinite; transform-origin: ${cx}px ${cy}px; }
        .inner-pyramid { animation: spin-ccw 2s   linear infinite; transform-origin: ${cx}px ${cy}px; }
      `}</style>
      <g className="outer-pyramid">
        <polygon points={outerPts} fill="none" stroke="#00cfff" strokeWidth="2" strokeLinejoin="round"/>
        <line x1={cx} y1={size*0.1} x2={cx} y2={outerH+size*0.1} stroke="#00cfff" strokeWidth="1.2" opacity="0.5"/>
        <ellipse cx={cx} cy={outerH+size*0.1} rx={outerW/2} ry={size*0.07} fill="none" stroke="#00cfff" strokeWidth="1.2" opacity="0.4"/>
      </g>
      <g className="inner-pyramid">
        <polygon points={innerPts} fill="none" stroke="#7b61ff" strokeWidth="2" strokeLinejoin="round"/>
        <line x1={cx} y1={size*0.3} x2={cx} y2={innerH+size*0.3} stroke="#7b61ff" strokeWidth="1.2" opacity="0.5"/>
        <ellipse cx={cx} cy={innerH+size*0.3} rx={innerW/2} ry={size*0.05} fill="none" stroke="#7b61ff" strokeWidth="1.2" opacity="0.4"/>
      </g>
    </svg>
  );
};

export default LoadingSpinner;
