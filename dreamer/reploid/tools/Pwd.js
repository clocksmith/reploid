/**
 * @fileoverview Pwd - Print working directory
 */

async function call(args = {}, deps = {}) {
  // VFS is always rooted at /
  return '/';
}

export const tool = {
  name: "Pwd",
  description: "Print working directory (pwd)",
  readOnly: true,
  call
};

export default call;
