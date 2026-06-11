/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";

interface IconProps {
  className?: string;
}

export const RadioUnitIcon: React.FC<IconProps> = ({
  className = "w-5 h-5",
}) => (
  <svg className={className} viewBox="0 0 1024 1024" fill="currentColor">
    <path d="M177.9 349.5c-0.1-54.6 21.2-107.1 59.4-146.1 8.4-8.4 11.6-20.6 8.4-32-3.2-11.4-12.2-20.2-23.7-23.1-11.5-2.9-23.6 0.6-31.8 9.2-105.5 108-104.1 280.8 3 387.1 12.9 12.8 33.7 12.8 46.5-0.1 12.8-12.9 12.8-33.7-0.1-46.6-39.6-39.2-61.8-92.6-61.7-148.4z m490.9-124.6c-13.1 12.6-13.5 33.4-0.9 46.5 42.7 44.5 41.8 114.9-2 158.3-8.6 8.2-12.2 20.5-9.2 32 2.9 11.5 11.9 20.6 23.4 23.7 11.5 3.1 23.8-0.3 32.1-8.9 69.3-68.6 70.8-180.2 3.2-250.6-6-6.3-14.3-9.9-23.1-10.1-8.7-0.2-17.2 3.1-23.5 9.1z m0 0" />
    <path d="M833.3 157.5c-8.2-8.6-20.3-12.1-31.8-9.2-11.5 2.9-20.5 11.7-23.7 23.1-3.2 11.4 0 23.6 8.4 32 80.1 82.1 79.1 213.5-2.3 294.4-12.9 12.8-13 33.7-0.1 46.5 12.8 12.9 33.7 13 46.6 0.1 106.9-106.2 108.2-278.9 2.9-386.9zM357.9 476.3c12.8-12.9 12.7-33.8-0.2-46.5-43.8-43.3-44.7-113.8-2-158.3 12.6-13.1 12.2-34-0.9-46.5-13.1-12.6-34-12.2-46.5 0.9-67.6 70.4-66.1 182 3.2 250.6 12.7 12.8 33.6 12.7 46.4-0.2z m202-50c32.1-21.4 46.4-61.3 35.3-98.2-11.1-36.9-45-62.3-83.6-62.5-38.6-0.2-72.8 24.8-84.3 61.6s2.4 76.8 34.3 98.6L313.8 831.9c-6.2 17.1 2.6 35.9 19.7 42.2 17.1 6.2 35.9-2.7 42.2-19.7l31.3-85.9h207.4l32 88c5.7 15.4 22.7 23.4 38.1 17.8l6-2.2c15.4-5.7 23.4-22.7 17.8-38.1L559.9 426.3z m-49.3 57.2l39.8 109.4h-79.6l39.8-109.4z m-82.4 226.4l21.3-58.5h122.2l21.3 58.5H428.2z m0 0" />
  </svg>
);

export const UserEquipmentIcon: React.FC<IconProps> = ({
  className = "w-5 h-5",
}) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M5 4a10 10 0 0 1 14 0" />
    <path d="M8.5 7a5 5 0 0 1 7 0" />
    <rect x="7" y="10" width="10" height="13" rx="2" strokeWidth="1.5" />
    <rect x="9" y="13" width="6" height="6" strokeWidth="1.5" />
    <path d="M11 21h2" strokeWidth="1.5" />
  </svg>
);

export const ScattererIcon: React.FC<IconProps> = ({
  className = "w-5 h-5",
}) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M 18.92,6.01 C 18.72,5.42 18.16,5 17.5,5 h -11 c -0.66,0 -1.21,0.42 -1.42,1.01 L 3,12 v 8 c 0,0.55 0.45,1 1,1 h 1 c 0.55,0 1,-0.45 1,-1 v -1 h 12 v 1 c 0,0.55 0.45,1 1,1 h 1 c 0.55,0 1,-0.45 1,-1 v -8 z M 6.5,16 c -0.83,0 -1.5,-0.67 -1.5,-1.5 0,-0.83 0.67,-1.5 1.5,-1.5 0.83,0 1.5,0.67 1.5,1.5 0,0.83 -0.67,1.5 -1.5,1.5 z m 11,0 c -0.83,0 -1.5,-0.67 -1.5,-1.5 0,-0.83 0.67,-1.5 1.5,-1.5 0.83,0 1.5,0.67 1.5,1.5 0,0.83 -0.67,1.5 -1.5,1.5 z M 5,11 6,6.5 h 12 l 1,4.5 z" />
  </svg>
);

export const DistributedUnitIcon: React.FC<IconProps> = ({
  className = "w-5 h-5",
}) => (
  <svg
    className={className}
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01"
    />
  </svg>
);

export const PanelIcon: React.FC<IconProps> = ({ className = "w-5 h-5" }) => (
  <svg
    className={className}
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z"
    />
  </svg>
);
