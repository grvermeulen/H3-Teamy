import { NextResponse } from "next/server";

export async function GET() {
  // Create a simple SVG mockup of a KNZB app screenshot
  const svg = `
    <svg width="400" height="600" xmlns="http://www.w3.org/2000/svg">
      <rect width="400" height="600" fill="#1a1a1a"/>
      
      <!-- Header -->
      <rect x="0" y="0" width="400" height="60" fill="#2a2a2a"/>
      <text x="20" y="35" fill="white" font-family="Arial" font-size="16" font-weight="bold">KNZB Waterpolo</text>
      
      <!-- Match title -->
      <text x="20" y="100" fill="white" font-family="Arial" font-size="18" font-weight="bold">De Rijn H3 - RZC H1</text>
      
      <!-- Date/time -->
      <text x="20" y="130" fill="#cccccc" font-family="Arial" font-size="14">20 september 2025 • 17:00</text>
      
      <!-- Venue -->
      <text x="20" y="155" fill="#cccccc" font-family="Arial" font-size="14">Sportfondsenbad De Bongerd, Wageningen</text>
      
 <!-- Score section -->
      <rect x="20" y="180" width="360" height="120" fill="#333333" stroke="#555555" stroke-width="1"/>
      <text x="40" y="210" fill="white" font-family="Arial" font-size="16" font-weight="bold">De Rijn H3</text>
      <text x="40" y="240" fill="white" font-family="Arial" font-size="32" font-weight="bold">12</text>
      
      <text x="200" y="210" fill="#cccccc" font-family="Arial" font-size="16">-</text>
      <text x="200" y="240" fill="#cccccc" font-family="Arial" font-size="32">-</text>
      
      <text x="320" y="210" fill="white" font-family="Arial" font-size="16" font-weight="bold">RZC H1</text>
      <text x="320" y="240" fill="white" font-family="Arial" font-size="32" font-weight="bold">8</text>
      
      <!-- Period scores -->
      <text x="20" y="280" fill="#cccccc" font-family="Arial" font-size="12">Periode scores: 3-2, 4-1, 2-3, 3-2</text>
      
      <!-- Stats -->
      <rect x="20" y="320" width="360" height="200" fill="#2a2a2a" stroke="#555555" stroke-width="1"/>
      <text x="30" y="350" fill="white" font-family="Arial" font-size="14" font-weight="bold">Wedstrijdstatistieken</text>
      
      <text x="30" y="380" fill="#cccccc" font-family="Arial" font-size="12">Doelpunten De Rijn: Hans (4), Jan (3), Marc (2), Steven (2), Arjan (1)</text>
      <text x="30" y="400" fill="#cccccc" font-family="Arial" font-size="12">Doelpunten RZC: Piet (3), Klaas (2), Henk (2), Jan (1)</text>
      <text x="30" y="420" fill="#cccccc" font-family="Arial" font-size="12">Reddingen keeper: 8</text>
      <text x="30" y="440" fill="#cccccc" font-family="Arial" font-size="12">Uitgesloten: 2x (De Rijn), 1x (RZC)</text>
      <text x="30" y="460" fill="#cccccc" font-family="Arial" font-size="12">MVP: Hans (De Rijn H3)</text>
      
      <!-- Footer -->
      <text x="20" y="550" fill="#888888" font-family="Arial" font-size="10">KNZB Waterpolo App</text>
    </svg>
  `;

  return new NextResponse(svg, {
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'no-cache',
    },
  });
}
