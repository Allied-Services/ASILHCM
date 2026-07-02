'use strict';

const pass = (req, res, next) => next();
const multerFn = jest.fn(() => ({
  single: jest.fn(() => pass),
  array:  jest.fn(() => pass),
}));
multerFn.memoryStorage = jest.fn(() => ({}));
multerFn.diskStorage   = jest.fn(() => ({}));
module.exports = multerFn;
