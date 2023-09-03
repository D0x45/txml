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

/** type of the tag (honestly i don't know how to describe this) */
export enum XMLTag {
  /** not yet known. usually is set for `type: XMLTokenType.TEXT` */
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

/** type of the token */
export enum XMLTokenType {
  /** any text value */
  TEXT = 0,
  /** opened tag (e.g. `<?`, `<!`, `<[a-zA-Z]`) */
  TAG_OPEN,
  /** closed tag (e.g. `</identifier>`) */
  TAG_CLOSE,
  /** self-closing tags (e.g. `?>`, `/>`, `-->`, `]]>`) */
  TAG_SELF_CLOSE,
}

/** the attribute item */
export type XMLTokenAttribute = {
  key: Array<number>;
  value: Array<number>;
  term_c: number;
  start: number;
  end: number;
};

/** every sequence is represented via this token type */
export type XMLToken = {
  type: XMLTokenType;
  tag: XMLTag;
  start: number;
  end: number;
  content: Array<number>;
  attributes?: Array<XMLTokenAttribute>;
};

/** xml node type (duh) */
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
const isAlphabetic = (codepoint: number) => (codepoint < 91 && codepoint > 64) || (codepoint < 123 && codepoint > 96);

// 0: 48, 9: 57
const isNumeric = (codepoint: number) => codepoint > 47 && codepoint < 58;

// '\r\t\n '
const isWhitespace = (codepoint: number) => [CodePoint.CR, CodePoint.LF, CodePoint.TAB, CodePoint.SPACE].includes(codepoint);

// Tag names cannot contain any of the characters !"#$%&'()*+,/;<=>?@[\]^`{|}~,
// nor a space character, and cannot begin with "-", ".", or a numeric digit.
const isValidIdentifier = (codepoint: number) =>
  isAlphabetic(codepoint) || isNumeric(codepoint) || codepoint === CodePoint.COLON || codepoint === CodePoint.HYPHEN;

// validate input
const isXMLInput = (i: unknown): i is XMLInput =>
  typeof i === 'string' ||
  (typeof i === 'object' &&
    i !== null &&
    'length' in i &&
    typeof i['length'] === 'number' &&
    'charCodeAt' in i &&
    typeof i['charCodeAt'] === 'function');

export function* xml_tokenize(xml: XMLInput, skipStartingWhitespace = false): Generator<Readonly<XMLToken>, never | void> {
  if (false === isXMLInput(xml)) throw new Error('xml input invalid');

  let pos = 0,
    line = 1,
    column = 1,
    /** state of the parser and what it expects */
    state = ParserState.NONE,
    rtState = ReadingTagState.READING_TAG_NAME,
    /** whether the whitespace can be omitted */
    canSkipWhitespace = skipStartingWhitespace;

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
  const entity_map: Record<string, CodePoint> = {
    quot: CodePoint.DOUBLE_QUOTE,
    amp: CodePoint.AMPERSAND,
    lt: CodePoint.ANGLE_BRACKET_OPEN,
    gt: CodePoint.ANGLE_BRACKET_CLOSE,
  };

  /** translate entities such as `&amp;` (AMPERSAND) and `&#039;` (SINGLE_QUOTE) */
  const translateEntity = (from: string): CodePoint => {
    if (from.at(0) === '#') return Number.parseInt(from.substring(1), 10);
    if (entity_map[from] === undefined) throwError(`translation for entity &${from}; not found`);
    return entity_map[from];
  };

  /** reset attribute temp values and optionally push this to the token's attributes beforehand */
  const resetAttribute = (push_to_current_token = false) => {
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
  const resetToken = (type?: XMLTokenType, tag?: XMLTag): void => {
    token.type = type === undefined ? XMLTokenType.TEXT : type;
    token.tag = tag === undefined ? XMLTag.NONE : tag;
    token.start = pos;
    token.end = -1;
    token.content.length = 0;
    token.attributes = undefined;
    resetAttribute();
  };

  /** clone current token and freeze it */
  const cloneAndFreezeToken = () => {
    const token_deep_copy: Readonly<XMLToken> = Object.freeze(structuredClone(token));
    Object.freeze(token_deep_copy.content);
    if (token_deep_copy.attributes !== undefined) Object.freeze(token_deep_copy.attributes);
    return token_deep_copy;
  };

  /** take a string and compare it byte-by-byte to xml input starting from the given index */
  const sliceEqualsStr = (needle: string, start_index: number): boolean => {
    for (let i = 0; i < needle.length; ++i) {
      if (needle.charCodeAt(i) !== xml.charCodeAt(start_index + i)) return false;
    }
    return true;
  };

  /** halts the tokenizing process and throws an error */
  const throwError = (msg: string): never => {
    const char_code = xml.charCodeAt(pos);
    throw new Error(
      `${msg} (pos:${pos}, c0:${char_code}/'${String.fromCharCode(
        char_code
      )}', canSkipWhitespace:${canSkipWhitespace}, state:${state}, rtState=${rtState}, column:${column}, line:${line}, token:${JSON.stringify(
        token
      )})`
    );
  };

  for (; pos < xml.length; ++pos) {
    /** character codepoint at pos + 0 */
    const c0 = xml.charCodeAt(pos);

    // maybe string ended? or any kind of unexpected output
    if (c0 === 0 || Number.isNaN(c0)) throwError('CodePoint NaN or Zero');

    // we reached a line feed
    if (c0 === CodePoint.LF) {
      ++line;
      column = 1;
    }

    // tabs are 4 characters
    column += c0 === CodePoint.TAB ? 4 : 1;

    // sometimes whitespace doesn't matter, just like our existence
    if (canSkipWhitespace && isWhitespace(c0)) continue;

    switch (state) {
      case ParserState.NONE:
        // whitespace-sensitive
        canSkipWhitespace = false;
        resetToken();

        // well, we are going to have a text node
        if (c0 !== CodePoint.ANGLE_BRACKET_OPEN) {
          state = ParserState.READING_TEXT_NODE;
          token.content.push(c0);
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
            ++token.start;
          } else if (c1 === CodePoint.FORWARD_SLASH) {
            token.type = XMLTokenType.TAG_CLOSE;
            token.tag = XMLTag.ARBITRARY;
            state = ParserState.READING_TAG_UNTIL_CLOSE;
            // skip the /
            ++pos;
            ++token.start;
          } else if (isAlphabetic(c1)) {
            token.type = XMLTokenType.TAG_OPEN;
            token.tag = XMLTag.ARBITRARY;
            state = ParserState.READING_TAG_UNTIL_CLOSE;
          } else if (sliceEqualsStr('![CDATA[', pos + 1)) {
            token.type = XMLTokenType.TAG_SELF_CLOSE;
            token.tag = XMLTag.CDATA;
            state = ParserState.READING_CDATA;
            // skip the ![CDATA[
            pos += 8;
            token.start += 8;
          } else if (sliceEqualsStr('!--', pos + 1)) {
            token.type = XMLTokenType.TAG_SELF_CLOSE;
            token.tag = XMLTag.COMMENT;
            state = ParserState.READING_COMMENT;
            // skip the !--
            pos += 3;
            token.start += 3;
          } else throwError('Invalid tag name');
        }
        break;

      case ParserState.READING_COMMENT:
        // well, the comment block ends after two more characters so why not end it right now?
        // you might ask isn't the comparison redundant here?
        // well, yes and no. i'm just trying to prevent an extra function call and an extra loop of O(3)
        if (c0 === CodePoint.HYPHEN && sliceEqualsStr('-->', pos)) {
          yield cloneAndFreezeToken();
          resetToken();
          canSkipWhitespace = true;
          state = ParserState.NONE;
          pos += 3; // jump to the end of comment block
        } else {
          token.content.push(c0);
          token.end = pos;
        }
        break;

      case ParserState.READING_CDATA:
        // data block reached the end of it
        if (c0 === CodePoint.SQUARE_BRACKET_CLOSE && sliceEqualsStr(']]>', pos)) {
          yield cloneAndFreezeToken();
          resetToken();
          canSkipWhitespace = true;
          state = ParserState.NONE;
          pos += 3; // jump to the end of cdata block
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
            token.content.push(translateEntity(String.fromCharCode(...entity_bytes)));
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
          yield cloneAndFreezeToken();
          resetToken();
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
          if (token.tag !== XMLTag.DECLARATION && c0 === CodePoint.QUESTION) throwError('ending an arbitrary tag with ?> is not allowed');
          // mark tags like <br/> and <input/> as self-closing:
          token.type = c0 === CodePoint.FORWARD_SLASH ? XMLTokenType.TAG_SELF_CLOSE : token.type;
          // update the end position for characters it might skip
          token.end = pos + (c0 === CodePoint.ANGLE_BRACKET_CLOSE ? 0 : 1);
          yield cloneAndFreezeToken();
          resetToken();
          canSkipWhitespace = true;
          state = ParserState.NONE;
          rtState = ReadingTagState.READING_TAG_NAME;
          pos += c0 === CodePoint.ANGLE_BRACKET_CLOSE ? 0 : 1; // skip the ? or / before >
          break; // end the switch(state) control flow
        }

        // <tagName attributeName="attributeQuotedValue" />
        if (rtState === ReadingTagState.READING_TAG_NAME) {
          if (isWhitespace(c0)) {
            rtState = ReadingTagState.READING_ATTR_NAME;
            canSkipWhitespace = true; // skip all whitespace until the first valid character
          } else if (isValidIdentifier(c0)) {
            token.content.push(c0);
          } else throwError('invalid character for identifier');
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
          } else if (attribute.key.length === 0 && !isAlphabetic(c0)) throwError('identifier must start with [a-zA-Z]');
          else if (!isValidIdentifier(c0)) throwError('invalid identifier for attribute name');
          else attribute.key.push(c0);
        }
        // =
        else if (rtState === ReadingTagState.EXPECTING_EQUAL_SIGN) {
          if (c0 === CodePoint.EQUAL) {
            canSkipWhitespace = true; // skip until reaching a " or '
            rtState = ReadingTagState.READING_ATTR_VALUE;
          } else throwError('expected =');
        } else if (rtState === ReadingTagState.READING_ATTR_VALUE) {
          canSkipWhitespace = false;
          // register the first character as the terminator character
          if (attribute.term_c === 0) {
            // check if value starts with " or '
            if (c0 !== CodePoint.DOUBLE_QUOTE && c0 !== CodePoint.SINGLE_QUOTE)
              throwError('expected value to start with either of DOUBLE_QUOTE or SINGLE_QUOTE');
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
            resetAttribute(true);
            canSkipWhitespace = true;
            rtState = ReadingTagState.READING_ATTR_NAME;
          } else attribute.value.push(c0);
        }
        break;
    } // switch (state)
  } // for (; pos < xml.length; ++pos)

  // throw error if stream ended unexpectedly
  if (state !== ParserState.NONE) {
    if (token.type === XMLTokenType.TEXT) yield cloneAndFreezeToken();
    else throwError('Unexpected end of stream');
  }
}

/** recursively parse nested tokens and return a tree  */
export function xml_tree(tokens: Generator<Readonly<XMLToken>>, tag_open_name?: string): Array<XMLNode> {
  const nodes: Array<XMLNode> = [];

  // iterate with the generator returned by xml_tokenize function
  tokens_loop: for (let next = tokens.next(); !next.done; next = tokens.next()) {
    const token = next.value;

    // tag closed
    if (token.type === XMLTokenType.TAG_CLOSE) {
      const tagName = String.fromCharCode(...token.content);
      if (typeof tag_open_name === 'string' && tag_open_name !== tagName)
        throw new Error(`unexpected </${tagName}> expected </${tag_open_name}>`);
      break tokens_loop;
    }

    // text nodes, cdata and comments
    if (token.tag === XMLTag.NONE || token.tag === XMLTag.CDATA || token.tag === XMLTag.COMMENT)
      nodes.push({
        type: token.tag,
        content: String.fromCharCode(...token.content),
      });

    // <?declaration ?>, <arbitrary> and <self-close/>
    if (token.tag === XMLTag.ARBITRARY || token.tag === XMLTag.DECLARATION) {
      const tagName = String.fromCharCode(...token.content);
      nodes.push({
        type: token.tag,
        tagName,
        attrMap: token.attributes
          ? Object.fromEntries(token.attributes.map((attr) => [String.fromCharCode(...attr.key), String.fromCharCode(...attr.value)]))
          : undefined,
        children: token.type === XMLTokenType.TAG_SELF_CLOSE ? undefined : xml_tree(tokens, tagName),
      });
    }
  }

  return nodes;
}
