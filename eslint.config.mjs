// The code style of the scripts, build and tests (npm run lint, npm run lint:fix). It only knows about the look of the
// code, spaces and line breaks; none of these rules can change what the code does.

import stylistic from '@stylistic/eslint-plugin';

const rules = {

    // indentation, quotes, semicolons
    '@stylistic/indent'        : [ 'error', 4, { SwitchCase : 1 } ],
    '@stylistic/quotes'        : [ 'error', 'single', { avoidEscape : true, allowTemplateLiterals : 'always' } ],
    '@stylistic/semi'          : [ 'error', 'always' ],
    '@stylistic/semi-spacing'  : 'error',
    '@stylistic/comma-dangle'  : [ 'error', 'only-multiline' ],
    '@stylistic/comma-spacing' : 'error',
    '@stylistic/comma-style'   : 'error',

    // air inside brackets: ( x ), [ 'a', 'b' ], { a : 1 }, ${ x }; no air for an index: list[0], and none for ()
    '@stylistic/space-in-parens'           : [ 'error', 'always', { exceptions : [ 'empty' ] } ],
    '@stylistic/array-bracket-spacing'     : [ 'error', 'always' ],
    '@stylistic/object-curly-spacing'      : [ 'error', 'always' ],
    '@stylistic/template-curly-spacing'    : [ 'error', 'always' ],
    '@stylistic/computed-property-spacing' : [ 'error', 'never' ],
    '@stylistic/key-spacing'               : [ 'error', { beforeColon : true, afterColon : true, align : 'colon' } ],

    // functions, keywords, operators
    '@stylistic/space-before-function-paren' : [ 'error', { anonymous : 'always', named : 'never', asyncArrow : 'always' } ],
    '@stylistic/function-call-spacing'       : [ 'error', 'never' ],
    '@stylistic/keyword-spacing'             : 'error',
    '@stylistic/space-infix-ops'             : 'error',
    '@stylistic/space-unary-ops'             : [ 'error', { words : true, nonwords : false, overrides : { '!' : true } } ],
    '@stylistic/arrow-spacing'               : 'error',
    '@stylistic/rest-spread-spacing'         : 'error',
    '@stylistic/space-before-blocks'         : 'error',
    '@stylistic/brace-style'                 : [ 'error', '1tbs', { allowSingleLine : true } ],
    '@stylistic/block-spacing'               : 'error',
    '@stylistic/new-parens'                  : 'error',
    '@stylistic/dot-location'                : [ 'error', 'property' ],

    // lines: spaces that line things up are allowed, blank lines are the author's to set (at most one, none at the ends)
    '@stylistic/no-multi-spaces'         : [ 'error', { ignoreEOLComments : true, exceptions : { Property : true, VariableDeclarator : true, AssignmentExpression : true, ImportAttribute : true } } ],
    '@stylistic/no-trailing-spaces'      : 'error',
    '@stylistic/no-multiple-empty-lines' : [ 'error', { max : 1, maxBOF : 0, maxEOF : 0 } ],
    '@stylistic/eol-last'                : 'error',
    '@stylistic/spaced-comment'          : [ 'error', 'always', { markers : [ '!' ] } ],

    // blank lines as groups: what belongs together stays together, a new thought starts after an empty line
    '@stylistic/padding-line-between-statements' : [ 'error',
        { blankLine : 'always', prev : '*', next : [ 'const', 'let', 'var' ] },
        { blankLine : 'always', prev : [ 'const', 'let', 'var' ], next : '*' },
        { blankLine : 'any', prev : [ 'const', 'let', 'var' ], next : [ 'const', 'let', 'var' ] },
        { blankLine : 'always', prev : '*', next : [ 'return', 'throw', 'if', 'for', 'while', 'do', 'switch', 'try', 'function', 'class' ] },
        { blankLine : 'always', prev : [ 'if', 'for', 'while', 'do', 'switch', 'try', 'function', 'class', 'block-like', 'multiline-expression' ], next : '*' },
        { blankLine : 'always', prev : '*', next : [ 'block-like', 'multiline-expression' ] },
        { blankLine : 'any', prev : [ 'case', 'default' ], next : '*' },
        { blankLine : 'any', prev : '*', next : [ 'break', 'case', 'default' ] },
    ],
    'local/function-padding' : 'error',

    // a comment starts a new thought: an empty line before it (not at the start of a block or an object)
    '@stylistic/lines-around-comment' : [ 'error', { beforeLineComment : true, allowBlockStart : true, allowObjectStart : true, allowArrayStart : true, allowClassStart : true } ],
};

// A function whose body has more than a statement (or more than a few lines) starts with an empty line, like in the PHP
// of the plugin. ESLint has no rule for that: padded-blocks pads every block, including those of an if.
const functionPadding = {

    meta : {
        type     : 'layout',
        fixable  : 'whitespace',
        schema   : [],
        messages : { missing : 'Leave an empty line after the opening brace of the function' },
    },

    create( context ) {

        const check = node => {

            const body = node.body;

            if ( ! body || 'BlockStatement' !== body.type )
                return;

            const first = context.sourceCode.getFirstToken( body );
            const next  = context.sourceCode.getTokenAfter( first, { includeComments : true } );
            const long  = body.loc.end.line - body.loc.start.line >= 5;

            // an empty body, a one-liner, or a body that is short and has one statement: no padding; or one that is padded already
            if ( ! next || next === context.sourceCode.getLastToken( body ) || next.loc.start.line === first.loc.end.line || next.loc.start.line - first.loc.end.line > 1 )
                return;

            if ( body.body.length < 2 && ! long )
                return;

            context.report( { node : body, loc : first.loc, messageId : 'missing', fix : fixer => fixer.insertTextAfter( first, '\n' ) } );
        };

        return { FunctionDeclaration : check, FunctionExpression : check, ArrowFunctionExpression : check };
    },
};

const local = { rules : { 'function-padding' : functionPadding } };

export default [

    { ignores : [ 'node_modules/**', 'asset/js/**', 'asset/css/**' ] },

    // the browser scripts: common.js and media-files.js are plain scripts, the others import modules
    { files : [ 'asset/src/js/common.js', 'asset/src/js/media-files.js' ], languageOptions : { ecmaVersion : 2022, sourceType : 'script' }, plugins : { '@stylistic' : stylistic, local }, rules },
    { files : [ 'asset/src/js/script.js', 'asset/src/js/modules/*.js' ], languageOptions : { ecmaVersion : 2022, sourceType : 'module' }, plugins : { '@stylistic' : stylistic, local }, rules },

    // build and tests (Node)
    { files : [ 'asset/src/build.mjs', 'tests/**/*.mjs', 'eslint.config.mjs' ], languageOptions : { ecmaVersion : 2022, sourceType : 'module' }, plugins : { '@stylistic' : stylistic, local }, rules },
];
