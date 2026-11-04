type Set
type Point

predicate Subset(Set inner, Set outer)
predicate Disjoint(Set first, Set second)
predicate Intersecting(Set first, Set second)
predicate In(Point point, Set set)
predicate NotIn(Point point, Set set)
