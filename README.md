# txml
tiny xml parser in typescript


# getting started
to start using it you can install it with npm:

```npm install d0x45/txml#master```

or if you are using deno just import the github raw url.

# how it works
i tried to keep this as simple as possible, so there are three basic functions:
```ts
parseXml(xml: XMLInput, canSkipStartingWhitespace = false): TokensIterator
```
this function consumes a `XMLInput` and returns a `TokensIterator`

```ts
buildXmlTree(tokens: TokensIterator, parentTagName?: string): Array<XMLNode>
```
a recursive function that takes a `TokensIterator` and returns an array of `XMLNode`s.

*note: the second argument is a way to validate closing tags (do not provide a value)*

```ts
walkXmlNodes(tokens: TokensIterator, callback: (path: string, node: XMLNode, parents: Array<XMLNode>) => void | true)
```
this function calls the provided callback on each node reporting the parent nodes, the node itself and a `path` argument which is a concatenation of parents' tagNames (e.g. `feed.entry.media:thumbnail`)

if the callback function returns boolean `true`, the iteration will be stopped

*note: the nodes returned by this function don't have the `children` field as it is not possible to compute that value*

here is a little example:
```js
const xml = `
<parent>
    <child>some text</child>
</parent>`;
const tokens = parseXml(xml);
const tree = buildXmlTree(tokens);
console.log(tree);
```

you can also iterate over tokens as they are being processed:
```js
for (const token of parseXml(xml)) {
    //     ^^^^^ is a XMLToken
    // do something with token
    // like maybe a callback?
    // see https://en.wikipedia.org/wiki/Simple_API_for_XML
}
```
or turn them into an array all at once:
```ts
const tokens = [...parseXml(xml)];
const tree = buildXmlTree(tokens.values());
```

# types

```ts
// the input to `parseXml` can be string or just something you put together to read from another buffer.
// as long as your input is able to read a few characters ahead (let's say like 5 or 6) it does the job.
type XMLInput =
  | string
  | {
      length: number;
      charCodeAt: (i: number) => number;
    };

// the parseXml function itself is implemented as a Generator
type TokensIterator =
  | Generator<Readonly<XMLToken>, never | void>
  | IterableIterator<Readonly<XMLToken>>;

enum XMLTokenType {
  TEXT = 0, // any text value
  TAG_OPEN, // opened tag (e.g. `<?`, `<!`, `<[a-zA-Z]`)
  TAG_CLOSE, // closed tag (e.g. `</identifier>`)
  TAG_SELF_CLOSE, // self-closing tags (e.g. `?>`, `/>`, `-->`, `]]>`)
}

enum XMLTag {
  NONE = 0, // not a tag. at least not a known tag. mostly used for TEXT
  DECLARATION, // xml prolog (e.g. `<?identifier ... ?>`)
  COMMENT, // comment block (e.g. `<!-- comment -->`)
  CDATA, // cdata block (e.g. `<![CDATA[ ]]>`)
  ARBITRARY, // any other tag name (e.g. `<identifier ... >`)
}

type XMLTokenAttribute = {
  key: Array<number>; // key is array of bytes
  value: Array<number>; // same goes for value
  term_c: number; // termination character is either " or ' (e.g. key="value")
  start: number; // the start index of the first character of key
  end: number; // the last term_c position
};

type XMLToken = {
  type: XMLTokenType; // type of token (obviously)
  tag: XMLTag; // the tag type of this token (why do i even bother writing this?)
  start: number; // start index of the token
  end: number; // end index of the token
  // array of charCodes for content. (e.g. [97,97,97,97])
  // to turn into string, must use String.fromCharCode(...token.content)
  // this field might contain the content of a CDATA, COMMENT or TEXT block,
  // or it might contain the tagName of ARBITRARY and DECLARATION tags
  // it all depends on the tag value
  content: Array<number>;
  // possible array of XMLTokenAttribute
  // convert to map with: getAttributesAsMap()
  attributes?: Array<XMLTokenAttribute>;
};

// represents any node that might contain children or be a textual node
type XMLNode =
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
```

# tl;dr
it's a tiny xml parser that does the job.
give it a star if you like it.
contributions are welcome
