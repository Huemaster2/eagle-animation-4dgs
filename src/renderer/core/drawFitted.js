import resizeToFit from 'intrinsic-scale';

// Same framing as the live view: the image covers the project ratio area, centred, with black outside it.
// Every layer drawn over the camera feed must use this so ghosts stay aligned with the live image.
export const drawFitted = (ctx, img, size, videoRatio = null, { background = '#000000' } = {}) => {
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, size.width, size.height);
  } else {
    ctx.clearRect(0, 0, size.width, size.height);
  }
  if (!img) {
    return;
  }
  const area = videoRatio ? resizeToFit('contain', { width: videoRatio, height: 1 }, { width: size.width, height: size.height }) : { width: size.width, height: size.height };
  const pos = resizeToFit('cover', { width: img.width, height: img.height }, { width: area.width, height: area.height });
  ctx.drawImage(img, 0, 0, img.width, img.height, Math.round(size.width / 2) - pos.width / 2, Math.round(size.height / 2) - pos.height / 2, pos.width, pos.height);
};

// Recolours the drawn image while keeping its luminance, so detail survives the tint
export const tintCanvas = (ctx, size, color, strength) => {
  if (!color || !(strength > 0)) {
    return;
  }
  ctx.save();
  ctx.globalCompositeOperation = 'color';
  ctx.globalAlpha = Math.min(1, strength);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, size.width, size.height);
  ctx.restore();
};
