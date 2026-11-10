// SPDX-License-Identifier: GPL-3.0-or-later
// Experimental original 3-layer convolutional segmentation CNN trained only
// on generated synthetic pictures, not game art or user assets.
// Decode float32 weights explicitly as little-endian to avoid platform assumptions.
const BASE64='J0ttPVyQjT1K7Aq+9TC0PWRYBb6neUe9Lsg2vg7z5TzcDq09R8pmvpSkqz2850C9yFtuPSnNZr1EGSo8eEHkvWyvhT1o6F+9e0s5vq6CGL0cYTG+AmfpvalsKL55Wyk99Z1/vljjPL6Ojxa+UroUPimV6L7iya49D7ervvxQr7+OsgK/6gOJPt5Vx74ZVxw+3LqbPY1CEj3LnA4+WVEDPTI+rD1PWrg9uOQ4PYBhOT0n2P88KEYWvqtdkzyYw649d6E5vH9sEr11dUe9GXbYvU8igr1mSxY9sMfEPVxxIb7DSK89uqOPvop2xb7ThA2+GautPetVnL74bag9SYVxvR41pjzON6K8Rz3kPaERjL1hpJe85ZisPFA4Cz5Z2sk9nUw8PqXdgL68y+U9tfnHvuwuGL+pvF2+PzapPQvtrL5OX888ntArvpo+mz3RB+u9dXORPR+hpr1/3H497BZRvho0FL6POU87660BvDUKyb3B5IY9x7ujPWmQQr6yvBu+oIwRPuNwxr1Cs8u9VTF1vsDoIr6VgJg7wY+qvQ1URr5YAT69Gm4wvrYrVL5oeR6+WVCAvn+kAkAllZk/KzFPvIZVvLyHT2q+5Q47vgq8A77mlEC99E9gviCYE76tijC+FoqUvcJNrj4A/hm/gxUHP/cAg7+k/g7Apb/vvkyo4Lp0RjS/HHmwPuatCj/Zlok+LIBJvvkSPj+imc8+OgdPPooB0j6g348+XK0TPlr1Gb7w/CK98+Zwvv5F0LvYKHu+8DITvt+mf70MQCO8b2MzPbYRrz1hUwe+hc4rPSjRkr1inpW84Xv/vRU6rz2Ihfq99Gy2PUxUh75w0gQ+08APvqKcaD0Cuo8+5GnZPTelxL5stUc9luqCvR6Jhb+7mJ4/cFxqvz4EET+piH1AumWdPyIag7/FrjE//oC/v/bujzwxe1m8C9QSPijTiD3L82C9aM0fPkNysjzR5+M9JJf/OtvfWTyk4n88xassvHUe1b0A5e+90nJgvd2x2L1B1P29Oj8FPUIICD1kdAC+nnoUvvfM0r2TNeq9MJ6BvR8QaL294oG+twknvl1OCT1WDi299SzovW0fUr77ylO+XiuBvkM5Ib7U70K9huN5Ozi6Cr0VAoG+inRPvuSEGb4yO0s9QPuxvT+RF76asP28OpAlvjiESr5IUNw9WqC9vYP2ir2m1TC+Q5DDPSe/5T1VElk9n+UZvjcXj764Ad+9kgXsPYi4ubzFrSI+qKmlPSP5ir2chqi87PZZvdKmor6yvIs+v55/vodRID4z3pY/vchEPojWur7s2zk+YMffvojYMD5qS709lC59Ph+9gT0kgJs8t0HtPdXrFj3MQrs9a5tivDNv6z8JN5k/XkiHvKHWRD+1UVxASn78vzl9jT6iXeW+CAFpvg==';
function decodedWeights() {
  const raw=atob(BASE64);
  if(raw.length!==265*4)throw new Error('invalid embedded emissive model');
  const view=new DataView(new ArrayBuffer(raw.length));
  for(let i=0;i<raw.length;i++)view.setUint8(i,raw.charCodeAt(i));
  const v=new Float32Array(265);
  for(let i=0;i<v.length;i++)v[i]=view.getFloat32(i*4,true);
  return {
    'c1.weight':v.subarray(0,108),'c1.bias':v.subarray(108,112),
    'c2.weight':v.subarray(112,256),'c2.bias':v.subarray(256,260),
    'c3.weight':v.subarray(260,264),'c3.bias':v.subarray(264,265),
  };
}
export const emissiveCnnWeights={
  version:1,
  architecture:'conv3x3-4-relu-conv3x3-4-relu-conv1x1-1-sigmoid',
  training:'synthetic-emissive-v1',
  weights:decodedWeights(),
};
