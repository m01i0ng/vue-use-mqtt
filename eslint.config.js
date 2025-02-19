// @ts-check
import m01i0ng from '@antfu/eslint-config'

export default m01i0ng(
  {
    type: 'lib',
  },
  {
    rules: {
      'node/prefer-global/buffer': 'off',
      'ts/explicit-function-return-type': 'off',
      'ts/no-use-before-define': 'warn',
    },
  },
)
