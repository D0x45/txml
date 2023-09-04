# txml
tiny xml parser in typescript


# getting started
to start using it you can install it with npm:
```npm install d0x45/txml#master```
or if you are using deno just import the github raw url.

# how it works
i tried to keep this as simple as possible, so there are two functions:
```ts
xml_tokenize(xml: XMLInput, skipStartingWhitespace = false): Generator<Readonly<XMLToken>, never | void>
```
```ts
 xml_tree(tokens: Generator<Readonly<XMLToken>>): Array<XMLNode>
 ```

the former is a generator function, and the latter is a recursive tree builder.

*i believe using a generator tokenizer is much more efficient, because it gives the flexibility to write other functions around it and parse xml into tokens as it goes forward.*

here is a little example:
```js
const xml = `
<parent>
    <child>some text</child>
</parent>`;
const tokens = xml_tokenize(xml);
const tree = xml_tree(tokens);
console.log(tree);
```

you can also iterate through tokens as they are being processed:
```js
for (const token of xml_tokenize(xml)) {
    //     ^^^^^ is a XMLToken
    // do something with token
    // like maybe a callback?
    // see https://en.wikipedia.org/wiki/Simple_API_for_XML
}
```

# types
the input:
```ts
type XMLInput =
  | string
  | {
      length: number;
      charCodeAt: (i: number) => number;
    };
```
the input to `xml_tokenize` can be string or just something you put together to read from another buffer. as long as your input is able to read a few characters ahead (let's say like 5 or 6) it does the job.

```ts
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
  // convert to map with: Object.fromEntries(token.attributes.map((attr) => [String.fromCharCode(...attr.key), String.fromCharCode(...attr.value)]))
  attributes?: Array<XMLTokenAttribute>;
};
```
and the last type for xml node:
*it's pretty self-explanatory (i will do anything not to explain my code) :0*
```ts
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
