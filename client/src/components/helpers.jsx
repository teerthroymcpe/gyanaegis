export function ProfileAvatar({ name, image, className = '', onClick }) {
  const Tag = onClick ? 'button' : 'span';
  return <Tag className={`profile-avatar ${className}`} type={onClick ? 'button' : undefined} onClick={onClick} aria-label={onClick ? `View ${name}'s profile` : undefined}>
    {image ? <img src={image} alt="" /> : (name?.trim()?.[0] || '?').toUpperCase()}
  </Tag>;
}

export function compressPostPhoto(file) {
  if (!file?.type.startsWith('image/')) return Promise.reject(new Error('Choose an image file.'));
  if (file.size > 15 * 1024 * 1024) return Promise.reject(new Error('Choose a photo smaller than 15 MB.'));
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not open that image.')); };
    image.onload = () => {
      let scale = Math.min(1, 900 / Math.max(image.width, image.height));
      let data = '';
      for (let attempt = 0; attempt < 7; attempt += 1) {
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
        data = canvas.toDataURL('image/jpeg', Math.max(.48, .82 - attempt * .06));
        if (data.length <= 340000) break;
        scale *= .82;
      }
      URL.revokeObjectURL(url);
      if (data.length > 340000) reject(new Error('That photo is too large. Choose another photo.'));
      else resolve(data);
    };
    image.src = url;
  });
}
