/**
 * Renders a crisp native-style mobile app mockup to canvas for visual verification and testing.
 */
export function drawCanvasMockApp(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  isViewOnly = false,
  isInteracted = false
) {
  // 1. Background
  ctx.fillStyle = '#141518';
  ctx.fillRect(0, 0, width, height);

  const scale = width / 360;

  // 2. Mobile status bar (top)
  const barH = 26 * scale;
  ctx.fillStyle = '#111215';
  ctx.fillRect(0, 0, width, barH);

  ctx.fillStyle = '#8b8f98';
  ctx.font = `600 ${Math.round(11 * scale)}px 'Geist', sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText('14:22', 14 * scale, barH / 2);

  ctx.textAlign = 'right';
  ctx.font = `500 ${Math.round(10 * scale)}px 'Geist', sans-serif`;
  ctx.fillText(isViewOnly ? 'LTE  88%' : '5G  94%', width - 14 * scale, barH / 2);

  // 3. App Header
  const headerY = barH;
  const headerH = 44 * scale;
  ctx.fillStyle = '#1a1b1f';
  ctx.fillRect(0, headerY, width, headerH);
  ctx.strokeStyle = '#26282d';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, headerY + headerH);
  ctx.lineTo(width, headerY + headerH);
  ctx.stroke();

  ctx.fillStyle = '#e6e7ea';
  ctx.font = `600 ${Math.round(13 * scale)}px 'Geist', sans-serif`;
  ctx.textAlign = 'left';
  ctx.fillText(
    isViewOnly
      ? 'iOS Simulator · View Only'
      : isInteracted
      ? 'Payment Completed'
      : 'Shopee Lite — Checkout',
    14 * scale,
    headerY + headerH / 2
  );

  const cardW = width - 24 * scale;
  const cardX = 12 * scale;

  if (isInteracted) {
    // Render interacted state (success receipt after tap on Pay button)
    const successY = headerY + headerH + 20 * scale;
    ctx.fillStyle = '#223829';
    ctx.strokeStyle = '#396144';
    ctx.beginPath();
    ctx.roundRect(cardX, successY, cardW, 110 * scale, 8 * scale);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#7fc98f';
    ctx.font = `700 ${Math.round(14 * scale)}px 'Geist', sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('✓ Payment Successful!', width / 2, successY + 30 * scale);

    ctx.fillStyle = '#d8d9dc';
    ctx.font = `500 ${Math.round(11 * scale)}px 'Geist', sans-serif`;
    ctx.fillText('Transaction Ref: JATIM-8921841', width / 2, successY + 58 * scale);

    ctx.fillStyle = '#9da1ab';
    ctx.font = `400 ${Math.round(10 * scale)}px 'Geist', sans-serif`;
    ctx.fillText('Amount: Rp 125.000 (Paid via Virtual Account)', width / 2, successY + 80 * scale);

    // Detail card
    const detailY = successY + 124 * scale;
    ctx.fillStyle = '#1a1b1f';
    ctx.strokeStyle = '#26282d';
    ctx.beginPath();
    ctx.roundRect(cardX, detailY, cardW, 90 * scale, 8 * scale);
    ctx.fill();
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.fillStyle = '#9cc3ff';
    ctx.font = `600 ${Math.round(11 * scale)}px 'Geist', sans-serif`;
    ctx.fillText('Order #ORD-2026-904', cardX + 12 * scale, detailY + 20 * scale);
    ctx.fillStyle = '#8b8f98';
    ctx.font = `400 ${Math.round(10.5 * scale)}px 'Geist', sans-serif`;
    ctx.fillText('Merchant: Bank Jatim Merchant Portal', cardX + 12 * scale, detailY + 42 * scale);
    ctx.fillText('Status: Confirmed & Shipping Prepared', cardX + 12 * scale, detailY + 62 * scale);

    // Back to merchant button
    const btnH = 40 * scale;
    const btnY = height - 20 * scale - btnH;
    ctx.fillStyle = '#343842';
    ctx.beginPath();
    ctx.roundRect(cardX, btnY, cardW, btnH, 8 * scale);
    ctx.fill();

    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.font = `600 ${Math.round(12 * scale)}px 'Geist', sans-serif`;
    ctx.fillText('Back to Home', width / 2, btnY + btnH / 2);
    return;
  }

  // 4. Cards
  const card1Y = headerY + headerH + 14 * scale;
  const card1H = 90 * scale;

  ctx.fillStyle = '#1a1b1f';
  ctx.strokeStyle = '#26282d';
  ctx.beginPath();
  ctx.roundRect(cardX, card1Y, cardW, card1H, 8 * scale);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#9cc3ff';
  ctx.font = `600 ${Math.round(11 * scale)}px 'Geist', sans-serif`;
  ctx.fillText('Order Summary', cardX + 12 * scale, card1Y + 18 * scale);

  ctx.fillStyle = '#8b8f98';
  ctx.font = `400 ${Math.round(11 * scale)}px 'Geist', sans-serif`;
  ctx.fillText('Subtotal (2 items)', cardX + 12 * scale, card1Y + 40 * scale);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#d8d9dc';
  ctx.fillText('Rp 145.000', cardX + cardW - 12 * scale, card1Y + 40 * scale);

  ctx.textAlign = 'left';
  ctx.fillStyle = '#7fc98f';
  ctx.fillText('Voucher (HEMAT20)', cardX + 12 * scale, card1Y + 62 * scale);
  ctx.textAlign = 'right';
  ctx.fillText('- Rp 20.000', cardX + cardW - 12 * scale, card1Y + 62 * scale);

  // Total divider
  const card2Y = card1Y + card1H + 12 * scale;
  const card2H = 50 * scale;
  ctx.fillStyle = '#1a1b1f';
  ctx.beginPath();
  ctx.roundRect(cardX, card2Y, cardW, card2H, 8 * scale);
  ctx.fill();
  ctx.stroke();

  ctx.textAlign = 'left';
  ctx.fillStyle = '#e6e7ea';
  ctx.font = `600 ${Math.round(12 * scale)}px 'Geist', sans-serif`;
  ctx.fillText('Total Payment', cardX + 12 * scale, card2Y + card2H / 2);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#6ea8ff';
  ctx.font = `600 ${Math.round(13 * scale)}px 'Geist', sans-serif`;
  ctx.fillText('Rp 125.000', cardX + cardW - 12 * scale, card2Y + card2H / 2);

  // Payment method card
  const card3Y = card2Y + card2H + 12 * scale;
  const card3H = 46 * scale;
  ctx.fillStyle = '#1f2a3d';
  ctx.strokeStyle = '#3a4f75';
  ctx.beginPath();
  ctx.roundRect(cardX, card3Y, cardW, card3H, 8 * scale);
  ctx.fill();
  ctx.stroke();

  ctx.textAlign = 'left';
  ctx.fillStyle = '#9cc3ff';
  ctx.font = `500 ${Math.round(11 * scale)}px 'Geist', sans-serif`;
  ctx.fillText('Payment Method', cardX + 12 * scale, card3Y + 16 * scale);
  ctx.fillStyle = '#d8d9dc';
  ctx.font = `400 ${Math.round(10 * scale)}px 'Geist', sans-serif`;
  ctx.fillText('Bank Jatim JConnect Virtual Account', cardX + 12 * scale, card3Y + 32 * scale);

  // Bottom action button
  const btnH = 40 * scale;
  const btnY = height - (isViewOnly ? 30 * scale : 20 * scale) - btnH;
  ctx.fillStyle = isViewOnly ? '#3a4f75' : '#6ea8ff';
  ctx.beginPath();
  ctx.roundRect(cardX, btnY, cardW, btnH, 8 * scale);
  ctx.fill();

  ctx.textAlign = 'center';
  ctx.fillStyle = isViewOnly ? '#d8d9dc' : '#0e1a2e';
  ctx.font = `600 ${Math.round(12 * scale)}px 'Geist', sans-serif`;
  ctx.fillText(isViewOnly ? 'Display Only Mode' : 'Pay Now · Rp 125.000', width / 2, btnY + btnH / 2);
}
