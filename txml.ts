// deno-lint-ignore-file no-case-declarations

enum CodePoint {
  EXCLAMATION = 33,
  DOUBLE_QUOTE = 34,
  SINGLE_QUOTE = 39,
  ANGLE_BRACKET_OPEN = 60,
  EQUAL = 61,
  ANGLE_BRACKET_CLOSE = 62,
  QUESTION = 63,
  FORWARD_SLASH = 47,
  BACK_SLASH = 92,
  SQUARE_BRACKET_OPEN = 91,
  SQUARE_BRACKET_CLOSE = 93,
  HYPHEN = 45,
  COLON = 58,
  LF = 10,
  CR = 13,
  TAB = 9,
  SPACE = 32,
  AMPERSAND = 38,
  SEMICOLON = 59,
}

enum ParserState {
  NONE = 0,
  READING_TAG_UNTIL_CLOSE,
  READING_TEXT_NODE,
  READING_COMMENT,
  READING_CDATA,
}

enum ReadingTagState {
  READING_TAG_NAME = 0,
  READING_ATTR_NAME,
  EXPECTING_EQUAL_SIGN,
  READING_ATTR_VALUE,
}

/**
 * the input accepted by the parser
 * if you are implementing it yourself,
 * do note that you must be able to
 * seek a few characters forward.
 */
export type XMLInput =
  | string
  | {
      length: number;
      charCodeAt: (i: number) => number;
    };

/** the generator result XMLToken */
export type TokensIterator = Generator<Readonly<XMLToken>, never | void> | IterableIterator<Readonly<XMLToken>>;

export enum XMLTag {
  /** not a tag. usually is set for `type: XMLTokenType.TEXT` */
  NONE = 0,
  /** xml prolog (e.g. `<?identifier ... ?>`) */
  DECLARATION,
  /** comment block (e.g. `<!-- comment -->`) */
  COMMENT,
  /** cdata block (e.g. `<![CDATA[ ]]>`) */
  CDATA,
  /** any other tag name (e.g. `<identifier ... >`) */
  ARBITRARY,
}

export enum XMLTokenType {
  /** any data tag (e.g. `XMLTag.NONE`, `XMLTag.CDATA` or `XMLTag.COMMENT`) */
  TEXT = 0,
  /** opened tag (e.g. `<?`, `<!`, `<[a-zA-Z]`) */
  TAG_OPEN,
  /** closed tag (e.g. `</identifier>`) */
  TAG_CLOSE,
  /** self-closing tags (e.g. `?>`, `/>`, `-->`, `]]>`) */
  TAG_SELF_CLOSE,
}

export type XMLTokenAttribute = {
  /** key name array of char codes */
  key: Array<number>;
  /** value array of char codes */
  value: Array<number>;
  /** termination character is either " or ' (e.g. key="value") */
  term_c: number;
  /** starting index of key */
  start: number;
  /** index of the last term_c character */
  end: number;
};

export type XMLToken = {
  type: XMLTokenType;
  tag: XMLTag;
  /** start index of the token */
  start: number;
  /** index of the last character that ended this token */
  end: number;
  /**
   * array of charCodes for content. (e.g. `[97,97,97,97]`)
   * to turn into string, you may use `String.fromCharCode(...token.content)`
   * this field might contain the content of a `CDATA`, `COMMENT` or `TEXT` block,
   * or it might contain the `tagName` of `ARBITRARY` and `DECLARATION` tags
   * it all depends on the `tag`'s value
   */
  content: Array<number>;
  /** you may use `getAttributesAsMap` */
  attributes?: Array<XMLTokenAttribute>;
};

/** recursive node type */
export type XMLNode =
  | {
      type: XMLTag.ARBITRARY | XMLTag.DECLARATION;
      tagName: string;
      attrMap?: Record<string, string>;
      children?: Array<XMLNode>;
    }
  | {
      type: XMLTag.NONE | XMLTag.CDATA | XMLTag.COMMENT;
      content: string;
    };

// A: 65, Z: 90, z: 122, a: 97
const _isAlphabetic = (codepoint: number) => (codepoint < 91 && codepoint > 64) || (codepoint < 123 && codepoint > 96);

// 0: 48, 9: 57
const _isNumeric = (codepoint: number) => codepoint > 47 && codepoint < 58;

// '\r\t\n '
const _isWhitespace = (codepoint: number) => [CodePoint.CR, CodePoint.LF, CodePoint.TAB, CodePoint.SPACE].includes(codepoint);

// Tag names cannot contain any of the characters !"#$%&'()*+,/;<=>?@[\]^`{|}~,
// nor a space character, and cannot begin with "-", ".", or a numeric digit.
const _isValidIdentifier = (codepoint: number) =>
  _isAlphabetic(codepoint) || _isNumeric(codepoint) || codepoint === CodePoint.COLON || codepoint === CodePoint.HYPHEN;

// validate input
const _isXMLInput = (i: unknown): i is XMLInput =>
  typeof i === 'string' ||
  (typeof i === 'object' &&
    i !== null &&
    'length' in i &&
    typeof i['length'] === 'number' &&
    'charCodeAt' in i &&
    typeof i['charCodeAt'] === 'function');

export function getContentAsStr(content: Array<number>): string {
  return content.reduce((str, c) => str + String.fromCharCode(c), '');
}

export function getAttributesAsMap(attributes: Array<XMLTokenAttribute>): Record<string, string> {
  return Object.fromEntries(attributes.map((attr) => [getContentAsStr(attr.key), getContentAsStr(attr.value)]));
}

export function* parseXml(xml: XMLInput, canSkipStartingWhitespace = false): TokensIterator {
  if (false === _isXMLInput(xml)) throw new Error('xml input invalid');

  let pos = 0,
    line = 1,
    column = 1,
    /** state of the parser and what it expects */
    state = ParserState.NONE,
    rtState = ReadingTagState.READING_TAG_NAME,
    /** whether the whitespace can be omitted */
    canSkipWhitespace = canSkipStartingWhitespace;

  /** current token */
  const token: XMLToken = {
    type: XMLTokenType.TEXT,
    tag: XMLTag.NONE,
    content: [],
    start: -1,
    end: -1,
    attributes: undefined,
  };

  /** current attribute */
  const attribute: XMLTokenAttribute = {
    key: [],
    value: [],
    term_c: 0,
    start: 0,
    end: 0,
  };

  /**
   * html entity translation table
   * @todo support dtd tags
   */
  const entityMap: Record<string, CodePoint> = {
    quot: CodePoint.DOUBLE_QUOTE,
    amp: CodePoint.AMPERSAND,
    lt: CodePoint.ANGLE_BRACKET_OPEN,
    gt: CodePoint.ANGLE_BRACKET_CLOSE,
    apos: CodePoint.SINGLE_QUOTE,
  };

  /** translate entities such as `&amp;` (AMPERSAND) and `&#039;` (SINGLE_QUOTE) */
  const _translateEntity = (from: string): CodePoint => {
    if (from.charAt(0) === '#') return Number.parseInt(from.substring(1), 10);
    if (entityMap[from] === undefined) _throwError(`translation for entity &${from}; not found`);
    return entityMap[from];
  };

  /** reset attribute temp values and optionally push this to the token's attributes beforehand */
  const _resetAttribute = (push_to_current_token = false) => {
    if (push_to_current_token) {
      if (token.attributes === undefined) token.attributes = [];
      const attribute_deep_copy: XMLTokenAttribute = Object.freeze(structuredClone(attribute));
      Object.freeze(attribute_deep_copy.key);
      Object.freeze(attribute_deep_copy.value);
      token.attributes.push(attribute_deep_copy);
    }
    attribute.key.length = 0;
    attribute.value.length = 0;
    attribute.term_c = 0;
    attribute.start = -1;
    attribute.end = -1;
  };

  /** reset current token data to default values */
  const _resetToken = (type?: XMLTokenType, tag?: XMLTag): void => {
    token.type = type === undefined ? XMLTokenType.TEXT : type;
    token.tag = tag === undefined ? XMLTag.NONE : tag;
    token.start = pos;
    token.end = -1;
    token.content.length = 0;
    token.attributes = undefined;
    _resetAttribute();
  };

  /** clone current token and freeze it */
  const _cloneAndFreezeToken = () => {
    const token_deep_copy: Readonly<XMLToken> = Object.freeze(structuredClone(token));
    Object.freeze(token_deep_copy.content);
    if (token_deep_copy.attributes !== undefined) Object.freeze(token_deep_copy.attributes);
    return token_deep_copy;
  };

  /** take a string and compare it byte-by-byte to xml input starting from the given index */
  const _sliceEqualsStr = (needle: string, start_index: number): boolean => {
    for (let i = 0; i < needle.length; ++i) {
      if (needle.charCodeAt(i) !== xml.charCodeAt(start_index + i)) return false;
    }
    return true;
  };

  /** halts the tokenizing process and throws an error */
  const _throwError = (msg: string): never => {
    const char_code = xml.charCodeAt(pos);
    throw new Error(
      `${msg} (pos:${pos}, c0:${char_code}/'${String.fromCharCode(
        char_code
      )}', canSkipWhitespace:${canSkipWhitespace}, state:${state}, rtState=${rtState}, line:${line}, column:${column}, token:${JSON.stringify(
        token
      )})`
    );
  };

  for (; pos < xml.length; ++pos) {
    /** character codepoint at pos + 0 */
    const c0 = xml.charCodeAt(pos);

    // maybe string ended? or any kind of unexpected output
    if (c0 === 0 || Number.isNaN(c0)) _throwError('CodePoint NaN or Zero');

    // we reached a line feed
    if (c0 === CodePoint.LF) {
      ++line;
      column = 1;
    }

    // tabs are 4 characters
    column += c0 === CodePoint.TAB ? 4 : 1;

    // sometimes whitespace doesn't matter, just like our existence
    if (canSkipWhitespace && _isWhitespace(c0)) continue;

    switch (state) {
      case ParserState.NONE:
        // whitespace-sensitive
        canSkipWhitespace = false;

        // NOTE: is the following line necessary?
        // _resetToken();

        // well, we are going to have a text node
        if (c0 !== CodePoint.ANGLE_BRACKET_OPEN) {
          state = ParserState.READING_TEXT_NODE;
          // bugfix: if c0 was an ampersand for entity escaping.
          // it would not be translated as the ampersand was not caught in the corresponding state;
          pos -= 1;
          column -= 1;
        }
        // yay, this is going to be a tag
        else {
          // c1: character after open brackets. one of: !, /, ?, [a-zA-Z]
          // the EXCLAMATION codepoint after open bracket itself gives
          // the possibility of either CDATA or COMMENT
          const c1 = xml.charCodeAt(pos + 1);

          if (c1 === CodePoint.QUESTION) {
            token.type = XMLTokenType.TAG_SELF_CLOSE;
            token.tag = XMLTag.DECLARATION;
            state = ParserState.READING_TAG_UNTIL_CLOSE;
            // skip the ?
            ++pos;
            ++column;
            ++token.start;
          } else if (c1 === CodePoint.FORWARD_SLASH) {
            token.type = XMLTokenType.TAG_CLOSE;
            token.tag = XMLTag.ARBITRARY;
            state = ParserState.READING_TAG_UNTIL_CLOSE;
            // skip the /
            ++pos;
            ++column;
            ++token.start;
          } else if (_isAlphabetic(c1)) {
            token.type = XMLTokenType.TAG_OPEN;
            token.tag = XMLTag.ARBITRARY;
            state = ParserState.READING_TAG_UNTIL_CLOSE;
          } else if (_sliceEqualsStr('![CDATA[', pos + 1)) {
            token.type = XMLTokenType.TAG_SELF_CLOSE;
            token.tag = XMLTag.CDATA;
            state = ParserState.READING_CDATA;
            // skip the ![CDATA[
            pos += 8;
            column += 8;
            token.start += 8;
          } else if (_sliceEqualsStr('!--', pos + 1)) {
            token.type = XMLTokenType.TAG_SELF_CLOSE;
            token.tag = XMLTag.COMMENT;
            state = ParserState.READING_COMMENT;
            // skip the !--
            pos += 3;
            column += 3;
            token.start += 3;
          } else _throwError('Invalid tag name');
        }
        break;

      case ParserState.READING_COMMENT:
        // well, the comment block ends after two more characters so why not end it right now?
        // you might ask isn't the comparison redundant here?
        // well, yes and no. i'm just trying to prevent an extra function call and an extra loop of O(3)
        if (c0 === CodePoint.HYPHEN && _sliceEqualsStr('-->', pos)) {
          yield _cloneAndFreezeToken();
          _resetToken();
          canSkipWhitespace = true;
          state = ParserState.NONE;
          // jump to the end of comment block
          pos += 3;
          column += 3;
        } else {
          token.content.push(c0);
          token.end = pos;
        }
        break;

      case ParserState.READING_CDATA:
        // data block reached the end of it
        if (c0 === CodePoint.SQUARE_BRACKET_CLOSE && _sliceEqualsStr(']]>', pos)) {
          yield _cloneAndFreezeToken();
          _resetToken();
          canSkipWhitespace = true;
          state = ParserState.NONE;
          // jump to the end of cdata block
          pos += 3;
          column += 3;
        } else {
          token.content.push(c0);
          token.end = pos;
        }
        break;

      case ParserState.READING_TEXT_NODE:
        // read until reaching an ANGLE_BRACKET_OPEN
        if (c0 !== CodePoint.ANGLE_BRACKET_OPEN) {
          // TODO: support for DTD
          // escaping for html entities
          if (c0 === CodePoint.AMPERSAND) {
            const entity_bytes = [];
            entity_loop: for (let ei = 1; 1; ++ei) {
              const ec = xml.charCodeAt(pos + ei);
              if (ec === CodePoint.SEMICOLON) break entity_loop;
              entity_bytes.push(ec);
              token.end = pos + ei;
            }
            ++token.end; // count the SEMICOLON that was skipped
            pos += entity_bytes.length + 1;
            column += entity_bytes.length + 1;
            token.content.push(_translateEntity(String.fromCharCode(...entity_bytes)));
          }
          // anything else is pretty much the same character
          else {
            token.content.push(c0);
            token.end = pos;
          }
        }
        // text node ended. now:
        // commit this token,
        // step back one character,
        // reset state and let the parser think this text never existed :o
        // NOTE: i'm the god of mischief
        else {
          yield _cloneAndFreezeToken();
          _resetToken();
          --pos;
          --column;
          state = ParserState.NONE;
          // TODO: this is unnecessary as its going to be set to false again
          // since whitespace can't be ignored while reading the tag name,
          // maybe remove the next line?
          canSkipWhitespace = true;
        }
        break;

      case ParserState.READING_TAG_UNTIL_CLOSE:
        // next character
        const c1 = xml.charCodeAt(pos + 1);

        // not inside attribute value and tag ended with either of: ?>, />, >
        if (
          (rtState === ReadingTagState.READING_ATTR_NAME || rtState === ReadingTagState.READING_TAG_NAME) &&
          ((c0 === CodePoint.FORWARD_SLASH && c1 === CodePoint.ANGLE_BRACKET_CLOSE) ||
            (c0 === CodePoint.QUESTION && c1 === CodePoint.ANGLE_BRACKET_CLOSE) ||
            c0 === CodePoint.ANGLE_BRACKET_CLOSE)
        ) {
          // this is not allowed: <tagName ... ?>
          if (token.tag !== XMLTag.DECLARATION && c0 === CodePoint.QUESTION) _throwError('ending an arbitrary tag with ?> is not allowed');
          // mark tags like <br/> and <input/> as self-closing:
          token.type = c0 === CodePoint.FORWARD_SLASH ? XMLTokenType.TAG_SELF_CLOSE : token.type;
          // update the end position for characters it might skip
          token.end = pos + (c0 === CodePoint.ANGLE_BRACKET_CLOSE ? 0 : 1);
          yield _cloneAndFreezeToken();
          _resetToken();
          canSkipWhitespace = true;
          state = ParserState.NONE;
          rtState = ReadingTagState.READING_TAG_NAME;
          // skip the ? or / before >
          pos += c0 === CodePoint.ANGLE_BRACKET_CLOSE ? 0 : 1;
          column += c0 === CodePoint.ANGLE_BRACKET_CLOSE ? 0 : 1;
          break; // end the switch(state) control flow
        }

        // <tagName attributeName="attributeQuotedValue" />
        if (rtState === ReadingTagState.READING_TAG_NAME) {
          if (_isWhitespace(c0)) {
            rtState = ReadingTagState.READING_ATTR_NAME;
            canSkipWhitespace = true; // skip all whitespace until the first valid character
          } else if (_isValidIdentifier(c0)) {
            token.content.push(c0);
          } else _throwError('invalid character for identifier');
        }
        // attributeName
        else if (rtState === ReadingTagState.READING_ATTR_NAME) {
          // the moment it gets the first non-whitespace character we switch this flag
          canSkipWhitespace = false;
          if (attribute.start === -1) attribute.start = pos; // dirty hack :o
          if (c0 === CodePoint.SPACE || c1 === CodePoint.EQUAL) {
            if (c1 === CodePoint.EQUAL && c0 !== CodePoint.SPACE) attribute.key.push(c0);
            rtState = ReadingTagState.EXPECTING_EQUAL_SIGN;
            canSkipWhitespace = true;
          } else if (attribute.key.length === 0 && !_isAlphabetic(c0)) _throwError('identifier must start with [a-zA-Z]');
          else if (!_isValidIdentifier(c0)) _throwError('invalid identifier for attribute name');
          else attribute.key.push(c0);
        }
        // =
        else if (rtState === ReadingTagState.EXPECTING_EQUAL_SIGN) {
          if (c0 === CodePoint.EQUAL) {
            canSkipWhitespace = true; // skip until reaching a " or '
            rtState = ReadingTagState.READING_ATTR_VALUE;
          } else _throwError('expected =');
        } else if (rtState === ReadingTagState.READING_ATTR_VALUE) {
          canSkipWhitespace = false;
          // register the first character as the terminator character
          if (attribute.term_c === 0) {
            // check if value starts with " or '
            if (c0 !== CodePoint.DOUBLE_QUOTE && c0 !== CodePoint.SINGLE_QUOTE)
              _throwError('expected value to start with either of DOUBLE_QUOTE or SINGLE_QUOTE');
            attribute.term_c = c0;
            break; // break this case block
          }

          // allow escaping the string with BACK_SLASH
          if (c0 === CodePoint.BACK_SLASH && c1 === attribute.term_c) {
            // add the escaped character to values
            // jump to the character after that
            attribute.value.push(c1);
            pos += 1;
            column += 1;
            break; // break switch(state)
          }

          // value ended with the terminator character
          if (c0 === attribute.term_c) {
            attribute.end = pos;
            _resetAttribute(true);
            canSkipWhitespace = true;
            rtState = ReadingTagState.READING_ATTR_NAME;
          } else attribute.value.push(c0);
        }
        break;
    } // switch (state)
  } // for (; pos < xml.length; ++pos)

  // throw error if stream ended unexpectedly
  if (state !== ParserState.NONE) {
    if (token.type === XMLTokenType.TEXT) yield _cloneAndFreezeToken();
    else _throwError('Unexpected end of stream');
  }
}

/** recursively parse nested tokens and return a tree  */
export function buildXmlTree(tokens: TokensIterator, parentTagName?: string): Array<XMLNode> {
  const nodes: Array<XMLNode> = [];

  // iterate with the generator returned by xml_tokenize function
  tokens_loop: for (let next = tokens.next(); !next.done; next = tokens.next()) {
    const token = next.value;

    // this is not supposed to happen, and i don't know why ts keeps bugging me
    if (typeof token !== 'object') return nodes;

    // tag closed
    if (token.type === XMLTokenType.TAG_CLOSE) {
      const tagName = String.fromCharCode(...token.content);
      if (typeof parentTagName === 'string' && parentTagName !== tagName)
        throw new Error(`unexpected </${tagName}> expected </${parentTagName}>`);
      break tokens_loop;
    }

    // text nodes, cdata and comments
    if (token.tag === XMLTag.NONE || token.tag === XMLTag.CDATA || token.tag === XMLTag.COMMENT)
      nodes.push({
        type: token.tag,
        content: getContentAsStr(token.content),
      });

    // <?declaration ?>, <arbitrary> and <self-close/>
    if (token.tag === XMLTag.ARBITRARY || token.tag === XMLTag.DECLARATION) {
      const tagName = String.fromCharCode(...token.content);
      nodes.push({
        type: token.tag,
        tagName,
        attrMap: token.attributes ? getAttributesAsMap(token.attributes) : undefined,
        children: token.type === XMLTokenType.TAG_SELF_CLOSE ? undefined : buildXmlTree(tokens, tagName),
      });
    }
  }

  return nodes;
}

/**
 * walk through nodes and call the callback on each node
 * @see https://en.wikipedia.org/wiki/Simple_API_for_XML
 */
export function walkXmlNodes(tokens: TokensIterator, callback: (path: string, node: XMLNode, parents: Array<XMLNode>) => void | true) {
  const parents = [];

  tokens_loop: for (const token of tokens) {
    if (token.type === XMLTokenType.TAG_OPEN) {
      parents.push({
        type: XMLTag.ARBITRARY,
        tagName: String.fromCharCode(...token.content),
        attrMap: token.attributes ? getAttributesAsMap(token.attributes) : undefined,
      });
    }

    if (token.type === XMLTokenType.TAG_CLOSE) {
      const expectedClosingTagName = parents.pop()?.tagName;
      const closedTagName = String.fromCharCode(...token.content);
      if (closedTagName !== expectedClosingTagName)
        throw `expected </${expectedClosingTagName}> got </${closedTagName}> at position: ${token.start}`;
    }

    if (token.type === XMLTokenType.TAG_SELF_CLOSE || token.type === XMLTokenType.TEXT) {
      const node = (
        token.type === XMLTokenType.TAG_SELF_CLOSE
          ? {
              type: token.tag,
              tagName: String.fromCharCode(...token.content),
              attrMap: token.attributes ? getAttributesAsMap(token.attributes) : undefined,
              children: undefined, // self-closing tags do not have any child
            }
          : {
              type: token.tag,
              content: getContentAsStr(token.content),
            }
      ) as XMLNode;

      // call the callback and if it returns true,
      // break the loop
      if (true === callback(parents.map((p) => p.tagName).join('.'), node, parents as Array<XMLNode>)) break tokens_loop;
    }
  }
}
