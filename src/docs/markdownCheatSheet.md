# Basic writing

## Headings

You can create a heading by adding one or more `#` symbols before your heading text.

### Heading level 3
###### Heading level 6

## Blockquotes

You can indicate blockquotes with a `>`.

> Blockquote

## Styling text

You can make text **bold** or *italic*. Both bold and italic can use either a `*` or an `_` around the text for styling.

*This text will be italic*
__This text will be bold__


# Lists

## Unordered lists

You can make an unordered list by preceding list items with either a `*` or a `-`.

- Item
- Item
* Item

## Ordered lists

You can make an ordered list by preceding list items with a number.

1. Item 1
2. Item 2
3. Item 3


# Code formatting

## Inline formats

Use single backticks to format text in a special `monospace format`.

## Multiple lines

You can use triple backticks to format text as its own distinct block.

```
var foo = 'bar' // baz
```


# Tables

You can create tables by assembling a list of words and dividing them with hyphens `-` (for the first row), and then separating each column with a pipe `|`:

First Header  | Second Header
------------- | -------------
Content Cell  | Content Cell
Content Cell  | Content Cell

By including colons within the header row, you can define text to be left-aligned, right-aligned, or center-aligned:

| Left-Aligned  | Center Aligned  | Right Aligned |
| :------------ |:---------------:| -----:|
| col 3 is      | some wordy text | $1600 |
| col 2 is      | centered        |   $12 |
| zebra stripes | are neat        |    $1 |


# Table of contents

You can insert a table of contents using the marker `[TOC]`:

[TOC]


# Maths

## MathJax

You can render *LaTeX* mathematical expressions using **MathJax** as on StackExchange:

The *Gamma function* satisfying $\Gamma(n) = (n-1)!\quad\forall n\in\mathbb N$ is via the Euler integral

$$
\Gamma(z) = \int_0^\infty t^{z-1}e^{-t}dt\,.
$$