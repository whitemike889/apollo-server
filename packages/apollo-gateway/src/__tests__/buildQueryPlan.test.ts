import path from 'path';
import { GraphQLSchema, GraphQLError } from 'graphql';
import {
  GraphQLSchemaModule,
  GraphQLSchemaValidationError,
} from 'apollo-graphql';
import gql from 'graphql-tag';
import { composeServices, buildFederatedSchema } from '@apollo/federation';

import { buildQueryPlan, buildOperationContext } from '../buildQueryPlan';

import { LocalGraphQLDataSource } from '../datasources/LocalGraphQLDataSource';
import { astSerializer, queryPlanSerializer } from '../snapshotSerializers';

expect.addSnapshotSerializer(astSerializer);
expect.addSnapshotSerializer(queryPlanSerializer);

function buildLocalService(modules: GraphQLSchemaModule[]) {
  const schema = buildFederatedSchema(modules);
  return new LocalGraphQLDataSource(schema);
}

describe('buildQueryPlan', () => {
  let schema: GraphQLSchema;

  beforeEach(() => {
    const serviceMap = Object.fromEntries(
      ['accounts', 'product', 'inventory', 'reviews', 'books'].map(
        serviceName => {
          return [
            serviceName,
            buildLocalService([
              require(path.join(
                __dirname,
                '__fixtures__/schemas',
                serviceName,
              )),
            ]),
          ] as [string, LocalGraphQLDataSource];
        },
      ),
    );

    let errors: GraphQLError[];
    ({ schema, errors } = composeServices(
      Object.entries(serviceMap).map(([serviceName, service]) => ({
        name: serviceName,
        typeDefs: service.sdl(),
      })),
    ));

    if (errors && errors.length > 0) {
      throw new GraphQLSchemaValidationError(errors);
    }
  });

  it(`should use a single fetch when requesting a root field from one service`, () => {
    const query = gql`
      query {
        me {
          name
        }
      }
    `;

    const queryPlan = buildQueryPlan(buildOperationContext(schema, query));

    expect(queryPlan).toMatchInlineSnapshot(`
      QueryPlan {
        Fetch(service: "accounts") {
          {
            me {
              ...__QueryPlanFragment_0__
            }
          }
          fragment __QueryPlanFragment_0__ on User {
            name
          }
        },
      }
    `);
  });

  it(`should use two independent fetches when requesting root fields from two services`, () => {
    const query = gql`
      query {
        me {
          name
        }
        topProducts {
          name
        }
      }
    `;

    const queryPlan = buildQueryPlan(buildOperationContext(schema, query));

    expect(queryPlan).toMatchInlineSnapshot(`
      QueryPlan {
        Parallel {
          Fetch(service: "accounts") {
            {
              me {
                ...__QueryPlanFragment_1__
              }
            }
            fragment __QueryPlanFragment_1__ on User {
              name
            }
          },
          Sequence {
            Fetch(service: "product") {
              {
                topProducts {
                  ...__QueryPlanFragment_2__
                }
              }
              fragment __QueryPlanFragment_2__ on Product {
                __typename
                ... on Book {
                  __typename
                  isbn
                }
                ... on Furniture {
                  name
                }
              }
            },
            Flatten(path: "topProducts.@") {
              Fetch(service: "books") {
                {
                  ... on Book {
                    __typename
                    isbn
                  }
                } =>
                {
                  ... on Book {
                    __typename
                    isbn
                    title
                    year
                  }
                }
              },
            },
            Flatten(path: "topProducts.@") {
              Fetch(service: "product") {
                {
                  ... on Book {
                    __typename
                    isbn
                    title
                    year
                  }
                } =>
                {
                  ... on Book {
                    name
                  }
                }
              },
            },
          },
        },
      }
    `);
  });

  it(`should use a single fetch when requesting multiple root fields from the same service`, () => {
    const query = gql`
      query {
        topProducts {
          name
        }
        product(upc: "1") {
          name
        }
      }
    `;

    const queryPlan = buildQueryPlan(buildOperationContext(schema, query));

    expect(queryPlan).toMatchInlineSnapshot(`
      QueryPlan {
        Sequence {
          Fetch(service: "product") {
            {
              topProducts {
                ...__QueryPlanFragment_3__
              }
              product(upc: "1") {
                ...__QueryPlanFragment_3__
              }
            }
            fragment __QueryPlanFragment_3__ on Product {
              __typename
              ... on Book {
                __typename
                isbn
              }
              ... on Furniture {
                name
              }
            }
          },
          Parallel {
            Sequence {
              Flatten(path: "topProducts.@") {
                Fetch(service: "books") {
                  {
                    ... on Book {
                      __typename
                      isbn
                    }
                  } =>
                  {
                    ... on Book {
                      __typename
                      isbn
                      title
                      year
                    }
                  }
                },
              },
              Flatten(path: "topProducts.@") {
                Fetch(service: "product") {
                  {
                    ... on Book {
                      __typename
                      isbn
                      title
                      year
                    }
                  } =>
                  {
                    ... on Book {
                      name
                    }
                  }
                },
              },
            },
            Sequence {
              Flatten(path: "product") {
                Fetch(service: "books") {
                  {
                    ... on Book {
                      __typename
                      isbn
                    }
                  } =>
                  {
                    ... on Book {
                      __typename
                      isbn
                      title
                      year
                    }
                  }
                },
              },
              Flatten(path: "product") {
                Fetch(service: "product") {
                  {
                    ... on Book {
                      __typename
                      isbn
                      title
                      year
                    }
                  } =>
                  {
                    ... on Book {
                      name
                    }
                  }
                },
              },
            },
          },
        },
      }
    `);
  });

  it(`should use a single fetch when requesting relationship subfields from the same service`, () => {
    const query = gql`
      query {
        topReviews {
          body
          author {
            reviews {
              body
            }
          }
        }
      }
    `;

    const queryPlan = buildQueryPlan(buildOperationContext(schema, query));

    expect(queryPlan).toMatchInlineSnapshot(`
      QueryPlan {
        Fetch(service: "reviews") {
          {
            topReviews {
              ...__QueryPlanFragment_6__
            }
          }
          fragment __QueryPlanFragment_4__ on Review {
            body
          }
          fragment __QueryPlanFragment_5__ on User {
            reviews {
              ...__QueryPlanFragment_4__
            }
          }
          fragment __QueryPlanFragment_6__ on Review {
            body
            author {
              ...__QueryPlanFragment_5__
            }
          }
        },
      }
    `);
  });

  it(`should use a single fetch when requesting relationship subfields and provided keys from the same service`, () => {
    const query = gql`
      query {
        topReviews {
          body
          author {
            id
            reviews {
              body
            }
          }
        }
      }
    `;

    const queryPlan = buildQueryPlan(buildOperationContext(schema, query));

    expect(queryPlan).toMatchInlineSnapshot(`
      QueryPlan {
        Fetch(service: "reviews") {
          {
            topReviews {
              ...__QueryPlanFragment_9__
            }
          }
          fragment __QueryPlanFragment_7__ on Review {
            body
          }
          fragment __QueryPlanFragment_8__ on User {
            id
            reviews {
              ...__QueryPlanFragment_7__
            }
          }
          fragment __QueryPlanFragment_9__ on Review {
            body
            author {
              ...__QueryPlanFragment_8__
            }
          }
        },
      }
    `);
  });

  describe(`when requesting an extension field from another service`, () => {
    it(`should add the field's representation requirements to the parent selection set and use a dependent fetch`, () => {
      const query = gql`
        query {
          me {
            name
            reviews {
              body
            }
          }
        }
      `;

      const queryPlan = buildQueryPlan(buildOperationContext(schema, query));

      expect(queryPlan).toMatchInlineSnapshot(`
        QueryPlan {
          Sequence {
            Fetch(service: "accounts") {
              {
                me {
                  ...__QueryPlanFragment_11__
                }
              }
              fragment __QueryPlanFragment_11__ on User {
                name
                __typename
                id
              }
            },
            Flatten(path: "me") {
              Fetch(service: "reviews") {
                {
                  ... on User {
                    __typename
                    id
                  }
                } =>
                {
                  ... on User {
                    reviews {
                      ...__QueryPlanFragment_10__
                    }
                  }
                }
                fragment __QueryPlanFragment_10__ on Review {
                  body
                }
              },
            },
          },
        }
      `);
    });

    describe(`when the parent selection set is empty`, () => {
      it(`should add the field's requirements to the parent selection set and use a dependent fetch`, () => {
        const query = gql`
          query {
            me {
              reviews {
                body
              }
            }
          }
        `;

        const queryPlan = buildQueryPlan(buildOperationContext(schema, query));

        expect(queryPlan).toMatchInlineSnapshot(`
          QueryPlan {
            Sequence {
              Fetch(service: "accounts") {
                {
                  me {
                    ...__QueryPlanFragment_13__
                  }
                }
                fragment __QueryPlanFragment_13__ on User {
                  __typename
                  id
                }
              },
              Flatten(path: "me") {
                Fetch(service: "reviews") {
                  {
                    ... on User {
                      __typename
                      id
                    }
                  } =>
                  {
                    ... on User {
                      reviews {
                        ...__QueryPlanFragment_12__
                      }
                    }
                  }
                  fragment __QueryPlanFragment_12__ on Review {
                    body
                  }
                },
              },
            },
          }
        `);
      });
    });

    // TODO: Ask martijn about the meaning of this test
    it(`should only add requirements once`, () => {
      const query = gql`
        query {
          me {
            reviews {
              body
            }
            numberOfReviews
          }
        }
      `;

      const queryPlan = buildQueryPlan(buildOperationContext(schema, query));

      expect(queryPlan).toMatchInlineSnapshot(`
        QueryPlan {
          Sequence {
            Fetch(service: "accounts") {
              {
                me {
                  ...__QueryPlanFragment_15__
                }
              }
              fragment __QueryPlanFragment_15__ on User {
                __typename
                id
              }
            },
            Flatten(path: "me") {
              Fetch(service: "reviews") {
                {
                  ... on User {
                    __typename
                    id
                  }
                } =>
                {
                  ... on User {
                    reviews {
                      ...__QueryPlanFragment_14__
                    }
                    numberOfReviews
                  }
                }
                fragment __QueryPlanFragment_14__ on Review {
                  body
                }
              },
            },
          },
        }
      `);
    });
  });

  describe(`when requesting a composite field with subfields from another service`, () => {
    it(`should add key fields to the parent selection set and use a dependent fetch`, () => {
      const query = gql`
        query {
          topReviews {
            body
            author {
              name
            }
          }
        }
      `;

      const queryPlan = buildQueryPlan(buildOperationContext(schema, query));

      expect(queryPlan).toMatchInlineSnapshot(`
        QueryPlan {
          Sequence {
            Fetch(service: "reviews") {
              {
                topReviews {
                  ...__QueryPlanFragment_17__
                }
              }
              fragment __QueryPlanFragment_16__ on User {
                __typename
                id
              }
              fragment __QueryPlanFragment_17__ on Review {
                body
                author {
                  ...__QueryPlanFragment_16__
                }
              }
            },
            Flatten(path: "topReviews.@.author") {
              Fetch(service: "accounts") {
                {
                  ... on User {
                    __typename
                    id
                  }
                } =>
                {
                  ... on User {
                    name
                  }
                }
              },
            },
          },
        }
      `);
    });

    describe(`when requesting a field defined in another service which requires a field in the base service`, () => {
      it(`should add the field provided by base service in first Fetch`, () => {
        const query = gql`
          query {
            topCars {
              retailPrice
            }
          }
        `;

        const queryPlan = buildQueryPlan(buildOperationContext(schema, query));

        expect(queryPlan).toMatchInlineSnapshot(`
          QueryPlan {
            Sequence {
              Fetch(service: "product") {
                {
                  topCars {
                    ...__QueryPlanFragment_18__
                  }
                }
                fragment __QueryPlanFragment_18__ on Car {
                  __typename
                  id
                  price
                }
              },
              Flatten(path: "topCars.@") {
                Fetch(service: "reviews") {
                  {
                    ... on Car {
                      __typename
                      id
                      price
                    }
                  } =>
                  {
                    ... on Car {
                      retailPrice
                    }
                  }
                },
              },
            },
          }
        `);
      });
    });

    describe(`when the parent selection set is empty`, () => {
      it(`should add key fields to the parent selection set and use a dependent fetch`, () => {
        const query = gql`
          query {
            topReviews {
              author {
                name
              }
            }
          }
        `;

        const queryPlan = buildQueryPlan(buildOperationContext(schema, query));

        expect(queryPlan).toMatchInlineSnapshot(`
          QueryPlan {
            Sequence {
              Fetch(service: "reviews") {
                {
                  topReviews {
                    ...__QueryPlanFragment_20__
                  }
                }
                fragment __QueryPlanFragment_19__ on User {
                  __typename
                  id
                }
                fragment __QueryPlanFragment_20__ on Review {
                  author {
                    ...__QueryPlanFragment_19__
                  }
                }
              },
              Flatten(path: "topReviews.@.author") {
                Fetch(service: "accounts") {
                  {
                    ... on User {
                      __typename
                      id
                    }
                  } =>
                  {
                    ... on User {
                      name
                    }
                  }
                },
              },
            },
          }
        `);
      });
    });
  });
  describe(`when requesting a relationship field with extension subfields from a different service`, () => {
    it(`should first fetch the object using a key from the base service and then pass through the requirements`, () => {
      const query = gql`
        query {
          topReviews {
            author {
              birthDate
            }
          }
        }
      `;

      const queryPlan = buildQueryPlan(buildOperationContext(schema, query));

      expect(queryPlan).toMatchInlineSnapshot(`
        QueryPlan {
          Sequence {
            Fetch(service: "reviews") {
              {
                topReviews {
                  ...__QueryPlanFragment_22__
                }
              }
              fragment __QueryPlanFragment_21__ on User {
                __typename
                id
              }
              fragment __QueryPlanFragment_22__ on Review {
                author {
                  ...__QueryPlanFragment_21__
                }
              }
            },
            Flatten(path: "topReviews.@.author") {
              Fetch(service: "accounts") {
                {
                  ... on User {
                    __typename
                    id
                  }
                } =>
                {
                  ... on User {
                    birthDate
                  }
                }
              },
            },
          },
        }
      `);
    });
  });

  describe(`for abstract types`, () => {
    // GraphQLError: Cannot query field "isbn" on type "Book"
    // Probably an issue with extending / interfaces in composition. None of the fields from the base Book type
    // are showing up in the resulting schema.
    it(`should add __typename when fetching objects of an interface type from a service`, () => {
      const query = gql`
        query {
          topProducts {
            price
          }
        }
      `;

      const queryPlan = buildQueryPlan(buildOperationContext(schema, query));

      expect(queryPlan).toMatchInlineSnapshot(`
        QueryPlan {
          Fetch(service: "product") {
            {
              topProducts {
                ...__QueryPlanFragment_23__
              }
            }
            fragment __QueryPlanFragment_23__ on Product {
              __typename
              ... on Book {
                price
              }
              ... on Furniture {
                price
              }
            }
          },
        }
      `);
    });
  });

  // GraphQLError: Cannot query field "isbn" on type "Book"
  // Probably an issue with extending / interfaces in composition. None of the fields from the base Book type
  // are showing up in the resulting schema.
  it(`should break up when traversing an extension field on an interface type from a service`, () => {
    const query = gql`
      query {
        topProducts {
          price
          reviews {
            body
          }
        }
      }
    `;

    const queryPlan = buildQueryPlan(buildOperationContext(schema, query));

    expect(queryPlan).toMatchInlineSnapshot(`
      QueryPlan {
        Sequence {
          Fetch(service: "product") {
            {
              topProducts {
                ...__QueryPlanFragment_25__
              }
            }
            fragment __QueryPlanFragment_25__ on Product {
              __typename
              ... on Book {
                price
                __typename
                isbn
              }
              ... on Furniture {
                price
                __typename
                upc
              }
            }
          },
          Flatten(path: "topProducts.@") {
            Fetch(service: "reviews") {
              {
                ... on Book {
                  __typename
                  isbn
                }
                ... on Furniture {
                  __typename
                  upc
                }
              } =>
              {
                ... on Book {
                  reviews {
                    ...__QueryPlanFragment_24__
                  }
                }
                ... on Furniture {
                  reviews {
                    ...__QueryPlanFragment_24__
                  }
                }
              }
              fragment __QueryPlanFragment_24__ on Review {
                body
              }
            },
          },
        },
      }
    `);
  });

  it(`interface fragments should expand into possible types only`, () => {
    const query = gql`
      query {
        books {
          ... on Product {
            name
            ... on Furniture {
              upc
            }
          }
        }
      }
    `;

    const queryPlan = buildQueryPlan(buildOperationContext(schema, query));

    expect(queryPlan).toMatchInlineSnapshot(`
      QueryPlan {
        Sequence {
          Fetch(service: "books") {
            {
              books {
                ...__QueryPlanFragment_26__
              }
            }
            fragment __QueryPlanFragment_26__ on Book {
              __typename
              isbn
              title
              year
            }
          },
          Flatten(path: "books.@") {
            Fetch(service: "product") {
              {
                ... on Book {
                  __typename
                  isbn
                  title
                  year
                }
              } =>
              {
                ... on Book {
                  name
                }
              }
            },
          },
        },
      }
    `);
  });

  it(`interface inside interface should expand into possible types only`, () => {
    const query = gql`
      query {
        product(upc: "") {
          details {
            country
          }
        }
      }
    `;

    const queryPlan = buildQueryPlan(buildOperationContext(schema, query));

    expect(queryPlan).toMatchInlineSnapshot(`
      QueryPlan {
        Fetch(service: "product") {
          {
            product(upc: "") {
              ...__QueryPlanFragment_28__
            }
          }
          fragment __QueryPlanFragment_27__ on ProductDetailsBook {
            country
          }
          fragment __QueryPlanFragment_28__ on Product {
            __typename
            ... on Book {
              details {
                ...__QueryPlanFragment_27__
              }
            }
            ... on Furniture {
              details {
                ...__QueryPlanFragment_27__
              }
            }
          }
        },
      }
    `);
  });
});
